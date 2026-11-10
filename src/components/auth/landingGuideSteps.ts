export interface GuideStep {
  stepNumber: number;
  id: string;
  image: string;
  badgeEn: string;
  badgeBn: string;
  titleEn: string;
  titleBn: string;
  summaryEn: string;
  summaryBn: string;
  pointsEn: string[];
  pointsBn: string[];
}

export const GUIDE_STEPS: GuideStep[] = [
  {
    stepNumber: 0,
    id: 'step-0',
    image: '/step-0.png',
    badgeEn: 'Step 0 · Sign In',
    badgeBn: 'ধাপ ০ · সাইন ইন',
    titleEn: 'Sign in with Google — or use Offline mode',
    titleBn: 'গুগল দিয়ে সাইন ইন করুন — অথবা অফলাইন মোড বেছে নিন',
    summaryEn:
      'Use Google Sign-In for full online sync, RAG plate recognition, live Chaldal market prices, and 24-hour chat rooms. No internet? Offline mode keeps your profile, local meal log, BMR/TDEE targets, and cached nutrition working on your device.',
    summaryBn:
      'অনলাইন সিঙ্ক, RAG খাবার শনাক্তকরণ, চালডাল লাইভ বাজারদর ও ২৪ ঘণ্টার রুম চ্যাটের জন্য গুগল দিয়ে সাইন ইন করুন। ইন্টারনেট না থাকলে অফলাইন মোডে প্রোফাইল, স্থানীয় খাবার লগ, বিএমআর/টিডিইই হিসাব ও ক্যাশড পুষ্টি তথ্য ব্যবহার করতে পারবেন।',
    pointsEn: [
      'Online: Google OAuth sync, Gemini Vision + RAG, live grocery pricing & Rooms',
      'Offline: Local profile & goals, BMR/TDEE calculation, meal history & conflict rules',
    ],
    pointsBn: [
      'অনলাইন: গুগল সিঙ্ক, ভিশন ও RAG মডেল, লাইভ বাজারদর এবং লাইভ রুম',
      'অফলাইন: ডিভাইসে প্রোফাইল, বিএমআর/টিডিইই লক্ষ্য, খাবার লগ ও সতর্কতা নিয়ম',
    ],
  },
  {
    stepNumber: 1,
    id: 'step-1',
    image: '/step1.png',
    badgeEn: 'Step 1 · Profile',
    badgeBn: 'ধাপ ১ · প্রোফাইল',
    titleEn: 'Set up your personal & clinical profile',
    titleBn: 'আপনার ব্যক্তিগত ও স্বাস্থ্য তথ্য সেট করুন',
    summaryEn:
      'Enter your age, height, weight, daily activity level, and dietary or medical rules (diabetes, hypertension, Halal, vegetarian, or allergens) so every calculation fits you.',
    summaryBn:
      'বয়স, উচ্চতা, ওজন, দৈনন্দিন শারীরিক সক্রিয়তা এবং খাদ্যাভ্যাস বা স্বাস্থ্য লক্ষ্য (ডায়াবেটিস, উচ্চ রক্তচাপ, হালাল, নিরামিষ, অ্যালার্জি) যোগ করুন—সব হিসাব আপনার অনুযায়ী তৈরি হবে।',
    pointsEn: [
      'Automatic Mifflin-St Jeor BMR & TDEE daily calorie target',
      'Unit switching between cm / ft·in and kg / lb',
    ],
    pointsBn: [
      'স্বয়ংক্রিয় মিফলিন-সেন্ট জিওর বিএমআর ও দৈনিক ক্যালরি লক্ষ্য',
      'সেমি/ফুট-ইঞ্চি এবং কেজি/পাউন্ড এককে সহজ পরিবর্তন',
    ],
  },
  {
    stepNumber: 2,
    id: 'step-2',
    image: '/step-2.png',
    badgeEn: 'Step 2 · Capture',
    badgeBn: 'ধাপ ২ · ছবি তুলুন',
    titleEn: 'Snap your plate or upload a dish photo',
    titleBn: 'খাবারের ছবি তুলুন অথবা গ্যালারি থেকে আপলোড করুন',
    summaryEn:
      'Tap the capture frame to open your camera or upload any saved photo of a home meal, restaurant thali, or dish.',
    summaryBn:
      'ক্যামেরা চালু করতে কার্ডটিতে চাপুন অথবা গ্যালারি থেকে ঘরের রান্না, থালি বা যেকোনো খাবারের ছবি আপলোড করুন।',
    pointsEn: [
      'Works with live mobile/desktop camera or file upload',
      'Supports mixed Bangladeshi & global multi-item plates',
    ],
    pointsBn: [
      'মোবাইল ও ডেস্কটপ ক্যামেরা বা গ্যালারি আপলোড সমর্থিত',
      'দেশি ও আন্তর্জাতিক একাধিক খাবারের প্লেট একসাথে শনাক্ত করে',
    ],
  },
  {
    stepNumber: 3,
    id: 'step-3',
    image: '/step-3.png',
    badgeEn: 'Step 3 · RAG Vision',
    badgeBn: 'ধাপ ৩ · RAG বিশ্লেষণ',
    titleEn: 'AI inspects the photo with our RAG culinary model',
    titleBn: 'আমাদের RAG মডেল ও ভিশন এআই ছবিটি বিশ্লেষণ করে',
    summaryEn:
      'Once uploaded, our Vision pipeline analyzes the meal. When your photo matches our indexed ChromaDB RAG knowledge base, portion weights and nutrition values are generated directly from the RAG model.',
    summaryBn:
      'ছবি আপলোডের পর ভিশন পাইপলাইন প্রতিটি খাবার পরীক্ষা করে। ছবিটি আমাদের ChromaDB RAG ডেটাবেজের সাথে মিলে গেলে সরাসরি RAG মডেল থেকে নির্ভুল পরিমাণ ও পুষ্টিমান তৈরি হয়।',
    pointsEn: [
      'Matches against indexed Bangladeshi & clinical RAG references',
      'Falls back to live Vision & food composition resolver for novel dishes',
    ],
    pointsBn: [
      'দেশি ও ক্লিনিক্যাল RAG রেফারেন্সের সাথে মিলিয়ে বিশ্লেষণ',
      'নতুন খাবারের ক্ষেত্রে লাইভ ভিশন ও ফুড কম্পোজিশন রেজলভার ব্যবহার',
    ],
  },
  {
    stepNumber: 4,
    id: 'step-4',
    image: '/step-4.png',
    badgeEn: 'Step 4 · Results',
    badgeBn: 'ধাপ ৪ · ফলাফল ও সতর্কতা',
    titleEn: 'Inspect detected items & dietary safety alerts',
    titleBn: 'শনাক্তকৃত খাবার ও স্বাস্থ্য নিরাপত্তা সতর্কতা দেখুন',
    summaryEn:
      'Review each detected item with estimated grams, confidence scores, and instant warnings whenever a food conflicts with your diet or medical rules—complete with swap ideas.',
    summaryBn:
      'প্রতিটি খাবারের আনুমানিক ওজন, আত্মবিশ্বাস স্কোর এবং আপনার ডায়েট বা স্বাস্থ্য নীতির সাথে কোনো অমিল থাকলে বিকল্প পরামর্শসহ তাৎক্ষণিক সতর্কতা দেখুন।',
    pointsEn: [
      'Highlights Halal, Vegetarian, Diabetic, Sodium & allergen conflicts',
      'Edit gram portions or swap items before logging',
    ],
    pointsBn: [
      'নিরামিষ, হালাল, ডায়াবেটিস, সোডিয়াম ও অ্যালার্জেন সতর্কতা',
      'লগ করার আগে গ্রাম পরিমাণ বা খাবার সম্পাদনার সুবিধা',
    ],
  },
  {
    stepNumber: 5,
    id: 'step-5',
    image: '/step-5.png',
    badgeEn: 'Step 5 · Nutrients',
    badgeBn: 'ধাপ ৫ · পুষ্টি ও গতিপথ',
    titleEn: 'Track daily calorie forecast & macro rings',
    titleBn: 'ক্যালরি গতিপথ ও ম্যাক্রো রিং বিশ্লেষণ দেখুন',
    summaryEn:
      'See how your current meal projects toward your daily calorie ceiling alongside Protein, Carbs, Fat progress donuts and micronutrient flags.',
    summaryBn:
      'এই খাবারটি আপনার দৈনিক ক্যালরি লক্ষ্যের দিকে কীভাবে প্রভাব ফেলছে তা গ্রাফে দেখুন এবং প্রোটিন, কার্বোহাইড্রেট ও চর্বির অনুপাত পর্যবেক্ষণ করুন।',
    pointsEn: [
      'Actual intake vs forecast curve against your daily target',
      'Shap-style breakdown of which item drives sodium or sugar',
    ],
    pointsBn: [
      'দৈনিক লক্ষ্যের বিপরীতে প্রকৃত গ্রহণ ও পূর্বাভাস রেখা',
      'কোন উপাদান থেকে কত সোডিয়াম বা চিনি আসছে তার ব্যাখ্যা',
    ],
  },
  {
    stepNumber: 6,
    id: 'step-6',
    image: '/step-6.png',
    badgeEn: 'Step 6 · Grocery',
    badgeBn: 'ধাপ ৬ · বাজার তালিকা',
    titleEn: 'Generate grocery lists with live Chaldal market prices',
    titleBn: 'চালডালের লাইভ বাজারদরসহ সাপ্তাহিক বাজারের তালিকা তৈরি করুন',
    summaryEn:
      'Turn logged meals into an organized weekly shopping list in one tap, track your BDT budget, and check live prices pulled from Chaldal.',
    summaryBn:
      'আপনার খাবার থেকে এক ট্যাপেই সাপ্তাহিক বাজারের তালিকা তৈরি করুন, টাকার বাজেট দেখুন এবং চালডাল থেকে সংগৃহীত লাইভ দাম যাচাই করুন।',
    pointsEn: [
      'Categorized items (Grains, Produce, Protein) with live BDT pricing',
      'Add custom items, toggle checked status & share your list',
    ],
    pointsBn: [
      'শস্য, শাকসবজি ও প্রোটিন অনুযায়ী বিভক্ত লাইভ দাম',
      'নতুন আইটেম যোগ করা, টিক দেওয়া ও তালিকা শেয়ার করার সুবিধা',
    ],
  },
  {
    stepNumber: 7,
    id: 'step-7',
    image: '/step-7.png',
    badgeEn: 'Step 7 · AI Coach',
    badgeBn: 'ধাপ ৭ · এআই কোচ',
    titleEn: 'Ask Dr. Susmit or Habit Coach in English & Bangla',
    titleBn: 'বাংলা ও ইংরেজিতে ড. সুস্মিত বা হ্যাবিট কোচকে প্রশ্ন করুন',
    summaryEn:
      'Get evidence-grounded answers about lowering glycemic load, reducing cooking oil, or adapting family meals—via text, voice input, or dish photo attachments.',
    summaryBn:
      'গ্লাইসেমিক লোড কমানো, তেল নিয়ন্ত্রণ বা ঘরের খাবার স্বাস্থ্যকর করার পরামর্শ নিন টেক্সট, ভয়েস বা খাবারের ছবি যুক্ত করে।',
    pointsEn: [
      'Local model first with online hosted AI fallback & spoken voice replies',
      'Contextual suggested prompts based on your profile & plate',
    ],
    pointsBn: [
      'লোকাল মডেল অগ্রাধিকার ও অনলাইন ব্যাকআপসহ ভয়েস উত্তর',
      'আপনার খাবার ও প্রোফাইল অনুযায়ী তৈরি তাৎক্ষণিক প্রশ্ন পরামর্শ',
    ],
  },
  {
    stepNumber: 8,
    id: 'step-8',
    image: '/step-8.png',
    badgeEn: 'Step 8 · Live Room',
    badgeBn: 'ধাপ ৮ · লাইভ রুম',
    titleEn: 'Chat & share dish cards with a 24-hour room code',
    titleBn: '২৪ ঘণ্টার রুম কোডে সরাসরি চ্যাট ও ডিশ কার্ড শেয়ার করুন',
    summaryEn:
      'Open Room from the top bar to auto-generate a 24-hour key. Friends join via code to exchange messages and meal cards—with zero server message logs and auto-wipe on refresh.',
    summaryBn:
      'উপরের বার থেকে রুম খুলে ২৪ ঘণ্টার কোড তৈরি করুন। বন্ধুরা কোড দিয়ে যোগ দিয়ে চ্যাট ও মিল কার্ড শেয়ার করতে পারবে—কোনো বার্তা সার্ভারে সংরক্ষণ হয় না।',
    pointsEn: [
      '24-hour reusable room key until cancelled or logged out',
      'Instant sharing of full plates or single dishes with macro totals',
    ],
    pointsBn: [
      'বাতিল বা লগআউট না করা পর্যন্ত ২৪ ঘণ্টা সক্রিয় রুম কোড',
      'ম্যাক্রোসহ সম্পূর্ণ প্লেট বা একক ডিশ কার্ড শেয়ার করার সুবিধা',
    ],
  },
];
