import { T } from '../data';
import { useTokens } from '../theme/useTokens';
import { LocalizedContent } from '../i18n/LanguageContext';

interface SectionLabelProps {
  children: React.ReactNode;
  action?: string;
  onAction?: () => void;
}

/** Small uppercase label used above sections in ProfileScreen and GroceryScreen. */
export default function SectionLabel({ children, action, onAction }: SectionLabelProps) {
  const { theme } = useTokens();
  const isDark = theme === 'dark';

  return (
    <LocalizedContent>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          margin: '0 0 10px',
        }}
      >
        <div
          style={{
            fontFamily: 'Inter',
            fontSize: 11.5,
            fontWeight: 700,
            color: isDark ? '#D8C4B6' : '#FFF0E2',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {children}
        </div>
        {action && (
          <button
            type="button"
            onClick={onAction}
            aria-label={typeof action === 'string' ? action : 'Action'}
            className="champagne-pill"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 250, 244, 0.75)',
              border: isDark ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid rgba(255, 255, 255, 0.85)',
              boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.8)',
              padding: '5px 12px',
              borderRadius: 999,
              fontFamily: 'Inter',
              fontSize: 11,
              fontWeight: 700,
              color: isDark ? '#FAF4EC' : '#3D271D',
              cursor: 'pointer',
              minHeight: 28,
              transition: 'background 160ms ease, transform 160ms ease, box-shadow 160ms ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.9)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 250, 244, 0.75)';
            }}
          >
            {action}
          </button>
        )}
      </div>
    </LocalizedContent>
  );
}
