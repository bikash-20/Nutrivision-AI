import type { AnalysisSource, AnalyzeResult, DetectedItem } from '../types/schemas';

interface PhotoReference {
  readonly description: string;
  readonly detected: readonly DetectedItem[];
}

const referenceItems = (...items: Array<[name: string, grams: number]>): DetectedItem[] =>
  items.map(([name, grams]) => ({
    name,
    confidence: 100,
    grams,
    note: 'Precomputed item; portion is estimated.',
  }));

const PHOTO_REFERENCES: Readonly<Record<string, PhotoReference>> = {
  ef7f927b231a8fc9600145f57d5e81217a36fa54e4ab89d7596190258a76c4f6: {
    description: 'Assorted Asian meal',
    detected: referenceItems(
      ['Thai green curry', 180],
      ['Pho with rice noodles', 240],
      ['Dim sum', 100],
      ['Spring rolls', 100],
      ['Bao buns', 120],
    ),
  },
  '4dc00d807132b46e3a10f48ed947c4768895126a7b67d040fb45f4f10261a392': {
    description: 'Soup and roasted meal spread',
    detected: referenceItems(
      ['Roasted chicken', 160],
      ['Roasted pork', 120],
      ['Roasted potatoes', 140],
      ['Vegetable soup', 180],
    ),
  },
  '5578720559e5832ef8f9cc65374a53372faa53fa592be5c5e6ae4756af52e6c4': {
    description: 'Roast dinner and pastries',
    detected: referenceItems(
      ['Roast chicken', 180],
      ['Roasted vegetables', 140],
      ['Pastry', 100],
      ['Tomato salad', 100],
    ),
  },
  ac2e9fe8e5fe6b8ae8d5513b3a7e91220df515a01e1f7f41a3df500c78a236e8: {
    description: 'Grilled chicken grain bowl',
    detected: referenceItems(
      ['Grilled chicken', 140],
      ['Grain bowl', 180],
      ['Tomato', 100],
      ['Yogurt sauce', 40],
      ['Salad greens', 60],
    ),
  },
  e6dc928c25123e57fee42831138d3f40c0e52d3695edcc5db7400fbc1d1bb88f: {
    description: 'Cafe brunch spread',
    detected: referenceItems(
      ['Fried eggs', 100],
      ['Toast', 80],
      ['Waffles with fruit', 160],
      ['Salad', 100],
      ['Burger', 180],
    ),
  },
  '3437da64654ac7d85abf3e7e06d8d609dd6fe0f4e778b695388d5dffbeadf869': {
    description: 'Mixed fast-food spread',
    detected: referenceItems(
      ['Burger', 180],
      ['Pizza', 160],
      ['French fries', 120],
      ['Fried chicken', 150],
      ['Sandwich', 150],
    ),
  },
  '522a98336f7dc131e31a9c239ce0466f83442e1f08fea197ca6958f48567754e': {
    description: 'Mixed seafood and protein meal',
    detected: referenceItems(
      ['Grilled salmon', 140],
      ['Chicken', 140],
      ['Rice noodles', 160],
      ['Mixed vegetables', 120],
    ),
  },
  '22bbb5b504d724f6d5777afee62666685dca5d55e4eca5a728d41ca984003e24': {
    description: 'Raw ingredients spread',
    detected: referenceItems(
      ['Eggs', 100],
      ['Chicken', 150],
      ['Salmon', 140],
      ['Broccoli', 100],
      ['Spinach', 60],
      ['Beans', 100],
    ),
  },
  '55f1d36f30b7c248488db9c89ac7e9872620df6f31a782c44aa1bb644a8e77ad': {
    description: 'Nuts, produce, beans, and dairy',
    detected: referenceItems(
      ['Almonds', 30],
      ['Pecans', 30],
      ['Quinoa', 100],
      ['Mushrooms', 100],
      ['Broccoli', 100],
      ['Milk', 150],
    ),
  },
  ffe610f2385aab45e19dabf107b7a8f8bcc91f3e4e8e591a9bfb43dc30158935: {
    description: 'Upscale lamb and meatball dinner',
    detected: referenceItems(
      ['Lamb chops', 160],
      ['Meatballs', 140],
      ['Hummus', 100],
      ['Crostini', 60],
    ),
  },
  '0ab49083790a410b95efd873d96742ffaac84741704de3e6a565bc5621358390': {
    description: 'Steak and lamb dinner',
    detected: referenceItems(
      ['Grilled steak', 160],
      ['Roasted lamb chops', 160],
      ['Croquettes', 100],
    ),
  },
  '64daa78498eb9af4f568a52ce2e7bbc4885752b8a813078831346bf2b9356689': {
    description: 'South Asian meal with flatbread and curry',
    detected: referenceItems(
      ['Paratha', 100],
      ['Chicken curry', 180],
      ['Potato curry', 120],
      ['Rice', 160],
      ['Yogurt sauce', 60],
    ),
  },
  '920217f7eef668349c22fbb8f67e3592de203802d295e1b250d6d1a7bb5b4fef': {
    description: 'Bengali thali with rice and curries',
    detected: referenceItems(
      ['Rice', 180],
      ['Dal', 120],
      ['Fish curry', 120],
      ['Fried fish', 100],
      ['Potato curry', 100],
      ['Sweet', 80],
    ),
  },
  '27a9cb9e9d96df165b8f44ec331fe7dc0357ee20b632be12a8626a0856b0d23b': {
    description: 'Vegetarian thali',
    detected: referenceItems(
      ['Rice', 180],
      ['Roti', 80],
      ['Chole', 120],
      ['Dal', 120],
      ['Vegetable curry', 120],
      ['Potato patty', 80],
    ),
  },
  cd94ba91d8def690491f0ed100cb8b842f28f8d845abb0b6e792ab3bebc84065: {
    description: 'Indian thali',
    detected: referenceItems(
      ['Puri', 80],
      ['Rice', 150],
      ['Egg curry', 140],
      ['Paneer curry', 120],
      ['Dal', 100],
      ['Dum aloo', 120],
      ['Rasgulla', 60],
    ),
  },
  '7c762447c6f06d1bc069334a5ca0272b7ba2ad663cec2c600938eb11b2eaf800': {
    description: 'Bengali festive thali',
    detected: referenceItems(
      ['Luchi', 80],
      ['Rice', 160],
      ['Fried fish', 120],
      ['Dal', 100],
      ['Meat curry', 150],
      ['Rosogolla', 60],
      ['Payesh', 80],
    ),
  },
  c3f53c4a5eb2ab471cd08e826e081e7790a16a4ce1031ebbb21657ab3a32b189: {
    description: 'Bengali thali with fish and meat curry',
    detected: referenceItems(
      ['Rice', 180],
      ['Dal', 120],
      ['Fried fish', 120],
      ['Meat curry', 150],
      ['Luchi', 80],
      ['Rosogolla', 60],
    ),
  },
};

export function findPrecomputedPhotoReference(hash: string): PhotoReference | null {
  return PHOTO_REFERENCES[hash.toLowerCase()] ?? null;
}

export function createPrecomputedPhotoResult(reference: PhotoReference): AnalyzeResult {
  const timestamp = Date.now();
  const trace = (
    stage: 'cache-check' | 'vision-id' | 'hf-validate' | 'reconcile',
    label: string,
    status: 'done' | 'fallback',
  ) => ({
    stage,
    label,
    status,
    startedAt: timestamp,
    finishedAt: timestamp,
  });

  return {
    source: 'precomputed_reference' satisfies AnalysisSource,
    detected: reference.detected.map((item) => ({ ...item })),
    pipeline: [
      trace('cache-check', 'Exact image reference match', 'done'),
      trace('vision-id', `Precomputed reference result: ${reference.description}`, 'fallback'),
      trace('hf-validate', 'Vision model bypassed for exact reference', 'fallback'),
      trace('reconcile', 'Precomputed labels; portions estimated', 'fallback'),
    ],
    is_food: true,
    input_mode: 'cooked_meal',
  };
}
