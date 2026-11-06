"""Schema-drift guard — `app/models/schemas.py` ↔ `src/types/schemas.ts`.

Per `NutriVision_AI_Blueprint.md` §8 and the lockstep comment at the top
of `app/models/schemas.py`, the two schema files must move together:
any change to one without the other is a breaking integration bug.

This test enforces that by:

  1. Running `scripts/dump-schemas.mjs` to extract every interface and
     every string-literal union from `src/types/schemas.ts` as JSON.
  2. Walking `app.models.schemas` and emitting the same shape for every
     Pydantic `BaseModel` and every `Literal[...]` alias.
  3. Normalizing (camelCase ↔ snake_case, optional ↔ nullable, array vs
     tuple) and asserting the two maps match.

The test is deliberately tolerant of cosmetic differences (e.g. `string`
on the TS side, `str` on the Python side; `number` vs `float`) but
strict about the *set* of types, fields, and string-literal values.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any

import pytest

from app.models import schemas as py_schemas

# ── Locating inputs ──────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[2]
TS_SCHEMA = REPO_ROOT / "src" / "types" / "schemas.ts"
DUMP_SCRIPT = REPO_ROOT / "scripts" / "dump-schemas.mjs"


def _load_ts_dump() -> dict[str, Any]:
    """Run the AST-walker and return its JSON output."""
    if not DUMP_SCRIPT.exists():
        pytest.skip(f"dump-schemas.mjs not found at {DUMP_SCRIPT}")
    if not TS_SCHEMA.exists():
        pytest.skip(f"TS schema not found at {TS_SCHEMA}")
    result = subprocess.run(
        ["node", str(DUMP_SCRIPT), str(TS_SCHEMA)],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    if result.returncode != 0:
        pytest.fail(
            f"dump-schemas.mjs failed (rc={result.returncode}):\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )
    return json.loads(result.stdout)


# ── Python side: walk `app.models.schemas` ───────────────────────────────


def _literal_values(annotation: Any) -> list[str] | None:
    """If `annotation` is a `Literal[...]` alias, return the list of
    allowed values. Otherwise return None."""
    origin = getattr(annotation, "__origin__", None)
    if origin is not None and getattr(origin, "__name__", "") == "Literal":
        args = getattr(annotation, "__args__", ())
        return [str(a) for a in args]
    # Python 3.11+ typing.Literal has __origin__ == Literal itself
    import typing

    if annotation is typing.Literal:
        return None
    return None


def _dump_python_schemas() -> dict[str, Any]:
    """Emit the same JSON shape the TS dump produces, for every Pydantic
    model and every Literal alias in `app.models.schemas`."""
    out: dict[str, Any] = {}

    # Literal aliases are module-level type aliases.
    for name in dir(py_schemas):
        if name.startswith("_"):
            continue
        value = getattr(py_schemas, name)
        if not isinstance(value, type) and not hasattr(value, "__args__"):
            continue
        lits = _literal_values(value)
        if lits is not None:
            out[name] = {"__literal": lits}
            continue
        # Pydantic models
        if isinstance(value, type) and issubclass(value, py_schemas.BaseModel):
            fields: dict[str, str] = {}
            for fname, finfo in value.model_fields.items():
                fields[fname] = _annotation_to_kind(finfo.annotation)
            out[name] = fields

    return out


_KIND_MAP: dict[Any, str] = {
    int: "number",
    float: "number",
    str: "string",
    bool: "boolean",
    type(None): "null",
}


def _find_literal_alias(values: tuple[str, ...]) -> str | None:
    """If `values` matches a Literal alias exported from
    `app.models.schemas`, return the alias name. The TS dump emits a
    bare type-name reference (e.g. `Allergen`) when the field's type is
    a top-level alias; matching on values lets the Python emitter do
    the same instead of inlining a `{__literal: [...]}` block."""
    for name in dir(py_schemas):
        if name.startswith("_"):
            continue
        value = getattr(py_schemas, name)
        lits = _literal_values(value)
        if lits is not None and tuple(lits) == values:
            return name
    return None


def _annotation_to_kind(annotation: Any) -> Any:
    """Reduce a Pydantic field annotation to a coarse kind so the diff
    is meaningful without being brittle. The output uses TS-style syntax
    (`string[]`, `string | null`, `[number, number, number, number]`)
    so it's directly comparable to the TS emitter's output."""
    if annotation is None:
        return "null"
    # Unwrap Optional / Union
    origin = getattr(annotation, "__origin__", None)
    args = getattr(annotation, "__args__", ())
    non_none = [a for a in args if a is not type(None)]

    # Literal → either an alias name (if it matches a known Literal alias
    # in the module) or an inline __literal block.
    if origin is not None and getattr(origin, "__name__", "") == "Literal":
        values = tuple(str(a) for a in args)
        alias_name = _find_literal_alias(values)
        if alias_name is not None:
            return alias_name
        return {"__literal": list(values)}

    if origin is list:
        inner = _annotation_to_kind(args[0]) if args else "unknown"
        return f"{inner}[]"
    if origin is tuple:
        if len(args) == 2 and args[1] is Ellipsis:
            return f"{_annotation_to_kind(args[0])}[]"
        return "[" + ", ".join(_annotation_to_kind(a) for a in args) + "]"
    if origin is dict:
        return "Record<string, unknown>"
    if origin is type(None) or (non_none and all(a is type(None) for a in non_none)):
        return "null"
    if non_none and len(non_none) == 1 and len(args) == 2:
        # Optional[X] → "X | null"
        return f"{_annotation_to_kind(non_none[0])} | null"
    if non_none and len(non_none) > 1:
        return " | ".join(sorted(_annotation_to_kind(a) for a in non_none))

    # Raw class object (e.g. `<class 'str'>` leaks in as str(annotation) →
    # "<class 'str'>"). Look up by class identity first, then by name.
    if isinstance(annotation, type):
        return _KIND_MAP.get(annotation, annotation.__name__)

    return _KIND_MAP.get(annotation, getattr(annotation, "__name__", "unknown"))


# ── Normalization (camelCase ↔ snake_case) ──────────────────────────────


_CAMEL_RE_1 = re.compile(r"(.)([A-Z][a-z]+)")
_CAMEL_RE_2 = re.compile(r"([a-z0-9])([A-Z])")


def _to_snake(name: str) -> str:
    """Convert a camelCase or PascalCase string to snake_case."""
    s = _CAMEL_RE_1.sub(r"\1_\2", name)
    s = _CAMEL_RE_2.sub(r"\1_\2", s)
    return s.replace("__", "_").lower()


def _to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


def _normalize_keys_to_snake(d: dict[str, Any]) -> dict[str, Any]:
    """Convert all keys in a field map to snake_case so a TS camelCase
    field and a Python snake_case field collapse to the same name."""
    return {_to_snake(k): v for k, v in d.items()}


def _normalize_kind(kind: Any) -> Any:
    """Lowercase and collapse optional markers so 'X | null' and 'X | None' match.
    Dict inputs (inline `__literal` blocks) are returned unchanged so the
    downstream `_kinds_compatible` can compare them structurally."""
    if isinstance(kind, dict):
        return kind
    s = kind.replace(" | None", " | null").replace(" | NoneType", " | null")
    s = re.sub(r"\bNoneType\b", "null", s)
    s = s.replace("|undefined", "|null")
    return s


# ── The actual test ──────────────────────────────────────────────────────


# Models the two files agree on by name (the rest are flagged as drift).
# This list is the *contract* — every name here MUST appear on both sides
# with matching fields. Types that live in only one file (frontend-only
# concerns like `Role`, `AuthSession`, `TabDescriptor`, `DemoUser`;
# backend-only like `DensityEntry`, `BaseModel`, the `BBox` alias) are
# tracked in the "unexpected types" test instead.
MUST_MATCH = {
    # Core nutrition primitives
    "NutritionFacts",
    "FoodDescriptor",
    "FoodCategory",
    # Vision pipeline outputs
    "DetectedItem",
    "AnalysisSource",
    "ResolvedItem",
    "PipelineTrace",
    "AnalyzeResult",
    "NutrientContribution",
    "ResolveNutritionResult",
    "InputMode",
    "RecipeSuggestion",
    "MenuItemAnalysis",
    # AI Coach
    "CoachRole",
    "CoachAgentType",
    "CoachMessage",
    "CoachChatRequest",
    "CoachChatResponse",
    "CoachTTSRequest",
    "CoachTTSResponse",
    # Profile + personalization
    "HealthGoals",
    "DietaryPreference",
    "Allergen",
    "Sex",
    "ActivityLevel",
    "GoalType",
    "DietType",
    "MedicalCondition",
    "HeightUnit",
    "WeightUnit",
    "UserProfile",
    # Grocery
    "GroceryItem",
    "GroceryGroup",
    "GroceryList",
    # Meals + aggregates
    "MealTotals",
    "MealEntry",
    "UserStats",
    "TodaySummary",
    "MacroTargets",
    # Auth & Admin Telemetry
    "Role",
    "AuthSession",
    "GoogleAuthRequest",
    "GoogleAuthResponse",
    "AdminUserSummary",
    "DailyMealVolume",
    "AdminMetrics",
    "AdminUserDetail",
    "PopularFoodItem",
    "ReviewQueueAction",
    "ReviewQueueItem",
    "ReviewQueueUpdateRequest",
}


def test_required_types_exist_on_both_sides() -> None:
    """Every contract-critical type name must be exported from both
    files. If you add a new type to one, you must add it to the other
    AND to `MUST_MATCH` in this test (or the next test will catch the
    missing name in the diff below)."""
    ts = _load_ts_dump()
    py = _dump_python_schemas()
    missing_in_ts = MUST_MATCH - set(ts.keys())
    missing_in_py = MUST_MATCH - set(py.keys())
    assert not missing_in_ts, f"TS schema is missing: {sorted(missing_in_ts)}"
    assert not missing_in_py, f"Python schema is missing: {sorted(missing_in_py)}"


def test_no_unexpected_types_in_either_file() -> None:
    """Defensive guard: the two schema files shouldn't have grown types
    that this test doesn't know about. Forces explicit acknowledgement
    of every new type via `MUST_MATCH`."""
    ts = _load_ts_dump()
    py_dump = _dump_python_schemas()
    # The Python walker picks up generic helpers like `BaseModel` and
    # `Field` from the import surface; filter those out before asserting.
    py_internal = {"BaseModel", "Field", "ConfigDict"}
    py_dump = {k: v for k, v in py_dump.items() if k not in py_internal}

    ts_only = set(ts.keys()) - MUST_MATCH
    py_only = set(py_dump.keys()) - MUST_MATCH
    # Allow known divergences:
    #   - TS-only: TabId, TabDescriptor, Role, AuthSession, DemoUser,
    #     ConfidenceBucket (frontend-only concerns)
    #   - Python-only: BBox (tuple alias), DensityEntry (portion helper),
    #     field_validator (helper), PipelineStage/PipelineStatus (named
    #     aliases — TS uses inline string-literal unions in PipelineTrace)
    allowed_ts_only = {
        "TabId",
        "TabDescriptor",
        "DemoUser",
        "ConfidenceBucket",
    }
    allowed_py_only = {
        "BBox",
        "DensityEntry",
        "field_validator",
        "PipelineStage",
        "PipelineStatus",
        "VisionDetectionResult",
    }

    unexpected_ts = ts_only - allowed_ts_only
    unexpected_py = py_only - allowed_py_only
    assert not unexpected_ts, (
        f"TS schema has types not declared in MUST_MATCH: {sorted(unexpected_ts)}. "
        f"Add them to the contract if they're real (and to `allowed_ts_only` if they're frontend-only)."
    )
    assert not unexpected_py, (
        f"Python schema has types not declared in MUST_MATCH: {sorted(unexpected_py)}. "
        f"Add them to the contract if they're real (and to `allowed_py_only` if they're backend-only)."
    )


@pytest.mark.parametrize("type_name", sorted(MUST_MATCH))
def test_field_shape_matches(type_name: str) -> None:
    """Per-type field comparison. Compares the SET of fields (after
    snake_casing TS names) and asserts each field's coarse type kind
    matches between the two sides.

    The kind comparison is intentionally loose (e.g. `number` matches
    `float`, `string` matches `str`) but strict about the structural
    shape (e.g. `string[]` does NOT match `string`). This catches
    "you forgot to make it a list on one side" without complaining
    about Pydantic v2 vs TS cosmetic differences.
    """
    ts = _load_ts_dump()
    py = _dump_python_schemas()

    if type_name not in ts or type_name not in py:
        pytest.skip(f"{type_name} missing on one side; covered by other tests")

    ts_def = ts[type_name]
    py_def = py[type_name]

    # Literal aliases: both sides become {"__literal": [...]}.
    if "__literal" in ts_def and "__literal" in py_def:
        assert sorted(ts_def["__literal"]) == sorted(py_def["__literal"]), (
            f"Literal values for {type_name!r} differ:\n"
            f"  TS:      {sorted(ts_def['__literal'])}\n"
            f"  Python:  {sorted(py_def['__literal'])}"
        )
        return
    if "__literal" in ts_def or "__literal" in py_def:
        pytest.fail(
            f"{type_name!r} is a Literal on one side and an object on the other"
        )

    # Object shape: compare normalized field sets.
    ts_fields = _normalize_keys_to_snake(ts_def)
    py_fields = py_def  # already snake_case

    only_in_ts = set(ts_fields) - set(py_fields)
    only_in_py = set(py_fields) - set(ts_fields)
    assert not only_in_ts, f"{type_name!r}: fields only in TS — {sorted(only_in_ts)}"
    assert not only_in_py, f"{type_name!r}: fields only in Python — {sorted(only_in_py)}"

    # Type-kind comparison for shared fields.
    mismatches: list[str] = []
    for field in sorted(set(ts_fields) & set(py_fields)):
        ts_kind = _normalize_kind(ts_fields[field])
        py_kind = _normalize_kind(py_fields[field])
        if not _kinds_compatible(ts_kind, py_kind):
            mismatches.append(
                f"  {field!r}: TS={ts_kind!r} vs Python={py_kind!r}"
            )
    assert not mismatches, (
        f"{type_name!r} has field-type mismatches:\n" + "\n".join(mismatches)
    )


def _kinds_compatible(ts_kind, py_kind) -> bool:
    """Loose structural match. `number` matches `float`/`int`. `X[]` matches
    `list[X]` (the Python emitter uses the bracketed form for cross-language
    readability). An optional kind (`X | null` or `X | None`) matches its
    non-optional counterpart on the other side because Pydantic's
    `Field(default=None)` collapses `T | None` to a non-optional kind, and
    the TS emitter collapses `T?` to `T`.

    This is enough to catch:
      - Wrong list element types
      - Scalar-vs-object mismatches
      - Tuple vs list collapses
    Without complaining about cosmetic cross-language differences.
    """
    # Literal object: both sides have __literal; compare sorted values.
    if isinstance(ts_kind, dict) and isinstance(py_kind, dict):
        return sorted(ts_kind.get("__literal", [])) == sorted(py_kind.get("__literal", []))
    if isinstance(ts_kind, dict) and isinstance(py_kind, str):
        # The Python side may have wrapped a literal in `| null`, OR may
        # have emitted a Literal alias name (e.g. `PipelineStage`). Look
        # up the alias values to see if they match the TS literal block.
        py_inner = _strip_optional(py_kind).strip()
        py_list_match = re.match(r"^list\[(.+)\]$", py_inner)
        if py_list_match is not None:
            py_inner = py_list_match.group(1)
        alias_values = _alias_literal_values(py_inner)
        if alias_values is not None:
            return sorted(alias_values) == sorted(ts_kind.get("__literal", []))
        return py_inner == _literal_block_to_str(ts_kind)
    if isinstance(py_kind, dict) and isinstance(ts_kind, str):
        ts_inner = _strip_optional(ts_kind).strip()
        ts_list_match = re.match(r"^(.+)\[\]$", ts_inner)
        if ts_list_match is not None:
            ts_inner = ts_list_match.group(1)
        alias_values = _alias_literal_values(ts_inner)
        if alias_values is not None:
            return sorted(alias_values) == sorted(py_kind.get("__literal", []))
        return ts_inner == _literal_block_to_str(py_kind)
    if isinstance(ts_kind, dict) or isinstance(py_kind, dict):
        return False
    ts = _strip_optional(ts_kind).strip()
    py = _strip_optional(py_kind).strip()
    if ts == py:
        return True
    # One side may have an optional that the other has stripped. After
    # _strip_optional both are bare, so equality holds — but if the strip
    # didn't match, also try comparing one stripped against the other raw
    # (in case one side already emitted the bare form).
    if ts == _strip_optional(py_kind).strip() and ts != py:
        return True
    # Array/list surface form: X[] ↔ list[X] (the Python emitter uses
    # brackets to stay close to the TS wire format).
    if ts.endswith("[]") and py.startswith("list[") and py.endswith("]"):
        return ts == f"{py[5:-1]}[]"
    if py.endswith("[]") and ts.startswith("list[") and ts.endswith("]"):
        return py == f"{ts[5:-1]}[]"
    # `list[X]` on both sides
    if ts.startswith("list[") and py.startswith("list[") and ts == py:
        return True
    # Cross-language: `X` (TS bare name) ↔ `app.models.schemas.X` (Python
    # full path). The Python emitter uses the class object as the field
    # annotation in some cases which leaks the qualified name.
    if ts == _short_py_name(py):
        return True
    if py == _short_py_name(ts):
        return True
    # Number widening
    number_kinds = {"number", "float", "int"}
    if ts in number_kinds and py in number_kinds:
        return True
    # String / str
    if {ts, py} <= {"string", "str"}:
        return True
    # Boolean / bool
    if {ts, py} <= {"boolean", "bool"}:
        return True
    return False


_ALIAS_VALUE_CACHE: dict[str, list[str] | None] = {}


def _alias_literal_values(name: str) -> list[str] | None:
    """If `name` is a Python `Literal[...]` alias, return its values.
    Cached because this is called per-field-comparison."""
    if name in _ALIAS_VALUE_CACHE:
        return _ALIAS_VALUE_CACHE[name]
    value = getattr(py_schemas, name, None)
    lits = _literal_values(value) if value is not None else None
    _ALIAS_VALUE_CACHE[name] = lits
    return lits


def _literal_block_to_str(block: dict[str, Any]) -> str:
    """Render a `{"__literal": [...]}` block back into the Python-emitter
    string form (`{'__literal': ['a', 'b']}`) so dict-vs-string kinds can
    be compared after optional stripping."""
    lits = block.get("__literal", [])
    return "{" + f"'__literal': {lits!r}" + "}"


def _strip_optional(kind: str) -> str:
    """`X | null`, `X | None`, `X | NoneType` → `X`."""
    s = kind
    for suffix in (" | null", " | None", " | NoneType"):
        if s.endswith(suffix):
            return s[: -len(suffix)]
    return s


def _short_py_name(kind: str) -> str:
    """`app.models.schemas.GroceryItem` → `GroceryItem`."""
    if "." in kind:
        return kind.rsplit(".", 1)[-1]
    return kind
