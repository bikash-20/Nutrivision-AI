import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { resolveFoodName } from '../lib/foodAliases';

export type Language = 'en' | 'bn';

const LANGUAGE_KEY = 'nutrivision-language';

const bnPhrases: Record<string, string> = {
  // Navigation & Greetings
  'Good morning': 'শুভ সকাল',
  'Good afternoon': 'শুভ দুপুর',
  'Good evening': 'শুভ সন্ধ্যা',
  'Hello': 'হ্যালো',
  'Hi': 'হ্যালো',
  'App navigation': 'অ্যাপ নেভিগেশন',
  'Take a photo': 'ছবি তুলুন',
  'Capture': 'ক্যামেরা',
  'Results': 'ফলাফল',
  'Nutrients': 'পুষ্টি',
  'Profile': 'প্রোফাইল',
  'Grocery': 'বাজার',
  'Shop smart': 'স্মার্ট বাজার',
  'Your plate': 'আপনার খাবার',
  'Your meal': 'আপনার খাবার',
  'Every bite has a story.': 'প্রতিটি লোকমারই একটি গল্প আছে।',
  'Snap your plate — we\'ll do the rest.': 'আপনার খাবারের ছবি তুলুন—বাকিটা আমরা হিসাব করে নেব।',
  'Snap': 'ছবি তুলুন',
  'we\'ll do the rest.': 'বাকিটা আমরা হিসাব করে নেব।',
  'Open Camera': 'ক্যামেরা খুলুন',
  'Tap to open Camera': 'ক্যামেরা খুলতে চাপ দিন',
  'Plate, ingredients, or a menu — all work': 'খাবারের থালা, উপকরণ বা মেনু—সবই চলবে',
  'Or upload a photo': 'অথবা ছবি আপলোড করুন',
  'Tap the card to open your camera': 'ক্যামেরা খুলতে কার্ডে চাপ দিন',
  'Log Meal': 'খাবার সংরক্ষণ করুন',
  'Recent': 'সাম্প্রতিক',
  'Recent meals': 'সাম্প্রতিক খাবার',
  'menu': 'মেনু',
  'all work': 'সবই চলবে',
  'Today': 'আজ',
  'Today so far': 'আজকের সারাংশ',
  'Today’s progress': 'আজকের অগ্রগতি',
  "Today's progress": 'আজকের অগ্রগতি',
  'No meals yet today': 'আজ এখনো কোনো খাবার যোগ করা হয়নি',
  'snap your first': 'প্রথম খাবারের ছবি তুলুন',
  'See all': 'সব দেখুন',
  'Daily goal': 'দৈনিক লক্ষ্য',

  // Vision pipeline & camera
  'Analyzing photo…': 'ছবি বিশ্লেষণ করা হচ্ছে…',
  'Analyzing your plate…': 'আপনার খাবার বিশ্লেষণ করা হচ্ছে…',
  'Analyzing your plate...': 'আপনার খাবার বিশ্লেষণ করা হচ্ছে…',
  'Analysis complete': 'বিশ্লেষণ সম্পন্ন হয়েছে',
  'Analysis unavailable — no sample results shown.': 'বিশ্লেষণ পাওয়া যায়নি—কোনো ফলাফল নেই।',
  'Could not analyze this photo. Check your connection and provider setup.': 'ছবিটি বিশ্লেষণ করা যায়নি। ইন্টারনেট সংযোগ ও প্রোভাইডার সেটআপ যাচাই করুন।',
  'No food was detected. Try a clearer photo.': 'কোনো খাবার শনাক্ত করা যায়নি। আরও পরিষ্কার ছবি দিয়ে চেষ্টা করুন।',
  'Camera permission denied': 'ক্যামেরা ব্যবহারের অনুমতি দেওয়া হয়নি',
  'No camera found': 'কোনো ক্যামেরা পাওয়া যায়নি',
  'Camera unavailable': 'ক্যামেরা ব্যবহার করা যাচ্ছে না',
  'Use photo': 'এই ছবি ব্যবহার করুন',
  'Upload photo': 'ছবি আপলোড করুন',
  'Take another photo': 'আরেকটি ছবি তুলুন',
  'Retake': 'আবার তুলুন',
  'Choose from gallery': 'গ্যালারি থেকে বেছে নিন',
  'Try again': 'আবার চেষ্টা করুন',

  // Results & Items Review
  'Detected items': 'শনাক্ত করা খাবার',
  'Food detected': 'শনাক্ত করা খাবার',
  'Detected foods': 'শনাক্ত করা খাবার',
  'Confidence': 'নিশ্চয়তা',
  'Portion size': 'পরিমাণ',
  'Estimated portion': 'আনুমানিক পরিমাণ',
  'Nutrition facts': 'পুষ্টিগুণ',
  'Nutrition details': 'পুষ্টির বিস্তারিত',
  'View nutrients': 'পুষ্টির তথ্য দেখুন',
  'View nutrition': 'পুষ্টির তথ্য দেখুন',
  'View nutrients for this meal': 'এই খাবারের পুষ্টি বিশ্লেষণ দেখুন',
  'Enter edit mode': 'সম্পাদনা শুরু করুন',
  'Exit edit mode': 'সম্পাদনা শেষ করুন',
  'Share detected items': 'শনাক্ত করা খাবার শেয়ার করুন',
  'selected': 'নির্বাচিত',
  'mode': 'মোড',
  'No items to review. Tap + to add a custom item.': 'পর্যালোচনার জন্য কোনো খাবার নেই। নিজে খাবার যোগ করতে + চাপ দিন।',
  'Sort: By Confidence. Tap to change.': 'সাজান: নিশ্চয়তার ভিত্তিতে। পরিবর্তন করতে চাপ দিন।',
  'Sort: By Confidence': 'সাজান: নিশ্চয়তার ভিত্তিতে',
  'By Calories (high → low)': 'ক্যালরি অনুযায়ী (বেশি থেকে কম)',
  'By Portion Size': 'পরিমাণ অনুযায়ী',
  'Alphabetical': 'বর্ণানুক্রমে',
  'Sort': 'সাজান',
  'Sort by': 'সাজান',
  'By Confidence': 'নিশ্চয়তার ভিত্তিতে',
  'Tap to change.': 'পরিবর্তন করতে চাপ দিন।',
  're-ranked': 'পুনরায় সাজানো হয়েছে',
  'Re-ranked for your diabetic profile': 'আপনার ডায়াবেটিস প্রোফাইল অনুযায়ী পুনরায় সাজানো হয়েছে',
  'Collapse summary': 'সারাংশ বন্ধ করুন',
  'Expand summary': 'সারাংশ খুলুন',
  'items': 'টি খাবার',
  'item': 'টি খাবার',
  'All items confirmed!': 'সব খাবার নিশ্চিত করা হয়েছে!',
  'Your meal is ready. See the full nutrient breakdown or make final tweaks.': 'আপনার খাবার প্রস্তুত। সম্পূর্ণ পুষ্টি বিশ্লেষণ দেখুন অথবা শেষ সমন্বয় করুন।',
  'Copied to clipboard': 'ক্লিপবোর্ডে কপি করা হয়েছে',
  'Confirmed selected': 'নির্বাচিত খাবার নিশ্চিত করা হয়েছে',
  'Confirmed': 'নিশ্চিত করা হয়েছে',
  'Frequently eaten with this': 'এর সাথে সাধারণত যা খাওয়া হয়',
  'already added': 'ইতিমধ্যে যোগ করা হয়েছে',
  'Added': 'যোগ করা হয়েছে',
  'Add custom item': 'নিজে খাবার যোগ করুন',
  'Add item': 'খাবার যোগ করুন',
  'Add items': 'খাবার যোগ করুন',
  'Add food': 'খাবার যোগ করুন',
  'Add': 'যোগ করুন',
  'Edit': 'সম্পাদনা',
  'Done': 'সম্পন্ন',
  'Undo': 'পূর্বাবস্থায় ফেরান',
  'Save': 'সংরক্ষণ',
  'Cancel': 'বাতিল',
  'Remove': 'সরান',
  'Back': 'ফিরে যান',
  'Next': 'পরবর্তী',
  'Review': 'পর্যালোচনা',
  'Adjust': 'সমন্বয়',
  'Confirm': 'নিশ্চিত',
  'Selected': 'নির্বাচিত',
  'Review all selected items': 'নির্বাচিত সব খাবার পর্যালোচনা করুন',
  'Confirm all selected high-confidence items': 'নির্বাচিত নিশ্চিত খাবার গ্রহণ করুন',
  'Bulk actions': 'একাধিক খাবারের কাজ',
  'Exit multi-select mode': 'একাধিক নির্বাচন মোড বন্ধ করুন',
  'Select all': 'সব নির্বাচন করুন',
  'Filter': 'ফিল্টার',
  'All': 'সব',
  'No results found': 'কোনো ফলাফল পাওয়া যায়নি',
  'No meals found': 'কোনো খাবার পাওয়া যায়নি',
  'Macros': 'ম্যাক্রো পুষ্টি',
  'Portion': 'পরিমাণ',
  'Alternatives': 'বিকল্প খাবার',
  'Pair with': 'একসাথে খাওয়ার পরামর্শ',
  'high-GI': 'উচ্চ গ্লাইসেমিক',
  'low-GI': 'কম গ্লাইসেমিক',
  'High glycemic impact': 'উচ্চ গ্লাইসেমিক প্রভাব',
  'Low glycemic impact': 'কম গ্লাইসেমিক প্রভাব',
  'Low confidence — tap to confirm': 'নিশ্চয়তা কম — নিশ্চিত করতে চাপ দিন',
  'Low confidence': 'নিশ্চয়তা কম',
  'High confidence': 'নিশ্চয়তা বেশি',
  'Tap to confirm': 'নিশ্চিত করতে চাপ দিন',

  // Nutrients & Clinical Explanations
  'This meal, explained': 'এই খাবারের পুষ্টি বিশ্লেষণ',
  'Back to results': 'ফলাফলে ফিরে যান',
  'Share nutrition summary': 'পুষ্টির বিশ্লেষণ শেয়ার করুন',
  'Filtered for your prediabetic-friendly goal.': 'আপনার প্রিডায়াবেটিস-বান্ধব লক্ষ্যের জন্য বাছাই করা হয়েছে।',
  'Personalized against your active goals.': 'আপনার সক্রিয় লক্ষ্যগুলো অনুযায়ী সাজানো হয়েছে।',
  'Calories': 'ক্যালরি',
  'calories': 'ক্যালরি',
  'Protein': 'প্রোটিন',
  'protein': 'প্রোটিন',
  'Carbs': 'কার্বোহাইড্রেট',
  'carbs': 'কার্বোহাইড্রেট',
  'Carbohydrates': 'কার্বোহাইড্রেট',
  'Fat': 'চর্বি',
  'fat': 'চর্বি',
  'Fiber': 'আঁশ',
  'fiber': 'আঁশ',
  'Fibre': 'আঁশ',
  'Sodium': 'সোডিয়াম',
  'sodium': 'সোডিয়াম',
  'Sugar': 'চিনি',
  'sugar': 'চিনি',
  'Micronutrients': 'অণুপুষ্টি',
  'Daily reference values': 'দৈনিক মানদণ্ড',
  'vs targets': 'লক্ষ্যের সাথে তুলনা',
  'Why these flags?': 'এই সতর্কতাগুলোর কারণ কী?',
  'Why we flagged this': 'সতর্কতার কারণ',
  'SHAP-style': 'অবদান বিশ্লেষণ',
  'Per-item reasoning': 'প্রতি খাবারের সুনির্দিষ্ট প্রভাব',
  'Per-item verdict explanations': 'প্রতি খাবারের সুনির্দিষ্ট প্রভাব',
  'Meal verdict': 'খাবারের সারসংক্ষেপ',
  'total': 'মোট',
  'target': 'লক্ষ্য',
  'targets': 'লক্ষ্যমাত্রা',
  'No meal analyzed yet': 'এখনো কোনো খাবার বিশ্লেষণ করা হয়নি',
  'Start by snapping a photo of your plate!': 'শুরু করতে আপনার খাবারের থালার একটি ছবি তুলুন!',
  'Why this is flagged:': 'সতর্কতার কারণ:',
  'Medical Disclaimer:': 'চিকিৎসা সতর্কতা:',
  'Daily summary': 'দৈনিক সারাংশ',
  'Nutrition summary': 'পুষ্টির সারাংশ',
  'Meal saved': 'খাবার সংরক্ষিত হয়েছে',
  'Meal history': 'খাবারের ইতিহাস',
  'Today’s meals': 'আজকের খাবার',
  "Today's meals": 'আজকের খাবার',

  // Profile Screen (Biometrics, Clinical, Targets)
  'Your health profile': 'আপনার স্বাস্থ্য প্রোফাইল',
  'these shape every flag and swap you see.': 'এগুলো আপনার দেখা প্রতিটি সতর্কতা ও পরামর্শ নির্ধারণ করে।',
  'Edit profile name': 'প্রোফাইলের নাম সম্পাদনা করুন',
  'Reset profile to defaults': 'প্রোফাইলের ডিফল্ট সেটিংস ফিরিয়ে আনুন',
  'Reset profile': 'প্রোফাইল রিসেট করুন',
  'Profile reset to defaults': 'প্রোফাইল ডিফল্ট সেটিংসে ফিরিয়ে নেওয়া হয়েছে',
  'Reset': 'রিসেট',
  'defaults': 'ডিফল্ট',
  'Sign out of NutriVision': 'নিউট্রিভিশন থেকে সাইন আউট করুন',
  'Sign out': 'সাইন আউট',
  'Signed in as': 'সাইন ইন করেছেন:',
  'Signed in': 'সাইন ইন করা হয়েছে',
  'Dhaka, Bangladesh': 'ঢাকা, বাংলাদেশ',
  '12-day streak': 'টানা ১২ দিনের ধারা',
  'streak': 'টানা ধারা',
  'servings': 'পরিবেশন',
  'serving': 'পরিবেশন',
  'Your Stats': 'আপনার পরিসংখ্যান',
  'Your stats': 'আপনার পরিসংখ্যান',
  'meals logged': 'নথিভুক্ত খাবার',
  'days active': 'সক্রিয় দিন',
  'avg kcal/day': 'গড় ক্যালরি/দিন',
  'Biological Sex': 'জৈবিক লিঙ্গ',
  'Biological sex': 'জৈবিক লিঙ্গ',
  'Male': 'পুরুষ',
  'Female': 'নারী',
  'Other': 'অন্যান্য',
  'Age': 'বয়স',
  'years': 'বছর',
  'year': 'বছর',
  'Decrease age by 1 year': 'বয়স ১ বছর কমান',
  'Increase age by 1 year': 'বয়স ১ বছর বাড়ান',
  'Used for Mifflin-St Jeor BMR calculation and pediatric safety rules': 'মিফলিন-সেন্ট জিওর বিএমআর গণনা ও শিশু পুষ্টি সুরক্ষায় ব্যবহৃত হয়',
  'Height': 'উচ্চতা',
  'cm': 'সেমি',
  'ft · in': 'ফুট · ইঞ্চি',
  'ft-in': 'ফুট-ইঞ্চি',
  'ft': 'ফুট',
  'in': 'ইঞ্চি',
  'Decrease height': 'উচ্চতা কমান',
  'Increase height': 'উচ্চতা বাড়ান',
  'Weight': 'ওজন',
  'kg': 'কেজি',
  'lb': 'পাউন্ড',
  'Decrease weight': 'ওজন কমান',
  'Increase weight': 'ওজন বাড়ান',
  'Activity Level': 'দৈনিক শারীরিক সক্রিয়তা',
  'Activity level': 'দৈনিক শারীরিক সক্রিয়তা',
  'Sedentary': 'বসে কাজ (পরিশ্রমহীন)',
  'Light': 'হালকা ব্যায়াম (১-২ দিন/সপ্তাহ)',
  'Moderate': 'মাঝারি ব্যায়াম (৩-৫ দিন/সপ্তাহ)',
  'Active': 'খুব সক্রিয় (৬-৭ দিন/সপ্তাহ)',
  'Very active': 'অতিরিক্ত সক্রিয় (ভারী পরিশ্রম)',
  'Primary Goal': 'প্রধান স্বাস্থ্য লক্ষ্য',
  'Primary goal': 'প্রধান স্বাস্থ্য লক্ষ্য',
  'Maintain weight': 'বর্তমান ওজন বজায় রাখা',
  'Maintain': 'ওজন বজায় রাখা',
  'Lose weight': 'ওজন কমানো',
  'Lose': 'ওজন কমানো',
  'Gain weight': 'ওজন বৃদ্ধি',
  'Gain': 'ওজন বৃদ্ধি',
  'Gain weight / muscle': 'ওজন বা পেশী বৃদ্ধি',
  'Target rate': 'সাপ্তাহিক পরিবর্তনের হার',
  'Target rate (kg/wk)': 'সাপ্তাহিক পরিবর্তনের হার (কেজি/সপ্তাহ)',
  'kg/wk': 'কেজি/সপ্তাহ',
  'recommended': 'প্রস্তাবিত',
  'max safe': 'সর্বোচ্চ নিরাপদ সীমা',
  'NutriVision': 'নিউট্রিভিশন',
  'NutriVision AI': 'নিউট্রিভিশন এআই',
  'Metabolic Estimate (Mifflin-St Jeor)': 'বিপাকীয় হিসাব (মিফলিন-সেন্ট জিওর)',
  'Metabolic Estimate': 'বিপাকীয় হিসাব',
  'Mifflin-St Jeor': 'মিফলিন-সেন্ট জিওর',
  'TDEE = BMR × Activity': 'মোট দৈনিক ব্যয় (টিডিইই) = বিএমআর × সক্রিয়তা',
  'BMR': 'বিএমআর',
  'TDEE': 'টিডিইই',
  'Resting burn (BMR)': 'বিশ্রামরত ব্যয় (বিএমআর)',
  'Daily burn (TDEE)': 'দৈনিক মোট ব্যয় (টিডিইই)',
  'Resting burn': 'বিশ্রামরত ব্যয়',
  'Daily burn': 'দৈনিক মোট ব্যয়',
  'Safe Target': 'নিরাপদ দৈনিক লক্ষ্য',
  'Apply calculated target': 'হিসাবকৃত লক্ষ্য নির্ধারণ করুন',
  'Daily target updated to': 'দৈনিক লক্ষ্য সফলভাবে নির্ধারণ করা হয়েছে:',
  'Medical Conditions': 'চিকিৎসাগত অবস্থা ও স্বাস্থ্য সতর্কতা',
  'Medical conditions': 'চিকিৎসাগত অবস্থা',
  'None': 'কোনোটিই নয়',
  'Prediabetes': 'প্রিডায়াবেটিস',
  'Type 2 Diabetes': 'টাইপ ২ ডায়াবেটিস',
  'Type 1 Diabetes': 'টাইপ ১ ডায়াবেটিস',
  'Hypertension': 'উচ্চ রক্তচাপ',
  'Hypertension (High BP)': 'উচ্চ রক্তচাপ',
  'High BP': 'উচ্চ রক্তচাপ',
  'High Cholesterol': 'উচ্চ কোলেস্টেরল',
  'Kidney': 'কিডনি রোগ',
  'Kidney condition': 'কিডনি রোগ',
  'Kidney Condition': 'কিডনি রোগ',
  'Diet Type': 'খাদ্যের ধরন',
  'Diet type': 'খাদ্যের ধরন',
  'Halal': 'হালাল',
  'Omnivore': 'সর্বভুক (সাধারণ খাবার)',
  'Vegetarian': 'নিরামিষভোজী',
  'Vegan': 'ভেগান',
  'Pescatarian': 'মাছসহ নিরামিষভোজী',
  'Kosher': 'কোশার',
  'Meals per day': 'দৈনিক খাবারের সংখ্যা',
  'Meals Per Day': 'দৈনিক খাবারের সংখ্যা',
  'meals': 'বেলা',
  'meal': 'বেলা',
  'Toggle': 'পরিবর্তন করুন',
  'goal': 'লক্ষ্য',
  'Health goals': 'স্বাস্থ্য লক্ষ্য',
  'Health conditions': 'স্বাস্থ্যগত অবস্থা',
  'Prediabetic-friendly': 'প্রিডায়াবেটিস-বান্ধব',
  'Diabetes-friendly': 'ডায়াবেটিস-বান্ধব',
  'High-protein': 'উচ্চ প্রোটিন',
  'High protein': 'উচ্চ প্রোটিন',
  'Budget-aware': 'বাজেট-সচেতন',
  'Budget friendly': 'বাজেট-বান্ধব',
  'Mediterranean': 'মেডিটেরেনিয়ান',
  'Dietary preferences': 'খাদ্যাভ্যাসের পছন্দ',
  'Gluten-free': 'গ্লুটেনমুক্ত',
  'Dairy-free': 'দুগ্ধজাত খাবারমুক্ত',
  'Allergens to avoid': 'যেসব অ্যালার্জি এড়াবেন',
  'Peanuts': 'চিনাবাদাম',
  'Tree nuts': 'গাছের বাদাম',
  'Shellfish': 'শেলফিশ',
  'Shell shellfish': 'শেলফিশ',
  'Soy': 'সয়া',
  'Eggs': 'ডিম',
  'Dairy': 'দুগ্ধজাত খাবার',
  'Gluten': 'গ্লুটেন',
  'Sesame': 'তিল',
  'Daily kcal target': 'দৈনিক ক্যালরি লক্ষ্য',
  'Daily calorie target': 'দৈনিক ক্যালরি লক্ষ্য',
  'Daily grocery budget': 'দৈনিক বাজারের বাজেট',
  'Servings on this plate': 'এই প্লেটের পরিবেশনের সংখ্যা',
  'Decrease servings': 'পরিবেশনের সংখ্যা কমান',
  'Increase servings': 'পরিবেশনের সংখ্যা বাড়ান',
  'Decrease daily kcal target by 50': 'দৈনিক ক্যালরির লক্ষ্য ৫০ কমান',
  'Increase daily kcal target by 50': 'দৈনিক ক্যালরির লক্ষ্য ৫০ বাড়ান',
  'Decrease budget by 50 taka': 'বাজেট ৫০ টাকা কমান',
  'Increase budget by 50 taka': 'বাজেট ৫০ টাকা বাড়ান',
  'Dark': 'ডার্ক',
  'Home progress bar': 'হোমের অগ্রগতি বার',
  'powers the Home progress bar — defaults to 2000 kcal/day': 'হোমের অগ্রগতি বার চালায়—ডিফল্ট দৈনিক লক্ষ্য ২০০০ কিলোক্যালরি',
  'per day — the Grocery screen applies this as a weekly cap of': 'প্রতিদিন—বাজারের পর্দায় এটি সাপ্তাহিক সীমা হিসেবে প্রয়োগ হয়:',
  'the Grocery screen applies this as a weekly cap of': 'বাজারের পর্দায় এটি সাপ্তাহিক সীমা হিসেবে প্রয়োগ হয়:',
  'used to scale macro values across Nutrients': 'পুষ্টি বিভাগে ম্যাক্রোর মান সমন্বয়ে ব্যবহৃত হয়',

  // Units
  'kcal': 'কিলোক্যালরি',
  'kcal/day': 'কিলোক্যালরি/দিন',
  'g': 'গ্রাম',
  'mg': 'মিগ্রা',
  'days': 'দিন',
  'day': 'দিন',
  'weeks': 'সপ্তাহ',
  'week': 'সপ্তাহ',
  'weekly': 'সাপ্তাহিক',
  'monthly': 'মাসিক',
  'per day': 'প্রতিদিন',
  'weekly cap': 'সাপ্তাহিক সীমা',

  // Grocery
  'This week': 'এই সপ্তাহ',
  'This week\'s list': 'এই সপ্তাহের তালিকা',
  'This week’s list': 'এই সপ্তাহের তালিকা',
  'Today\'s list': 'আজকের তালিকা',
  'Today’s list': 'আজকের তালিকা',
  'spent': 'খরচ হয়েছে',
  'left': 'বাকি',
  'left of': 'বাকি',
  'Share list': 'তালিকা শেয়ার করুন',
  'Share Grocery list': 'বাজারের তালিকা শেয়ার করুন',
  'Your grocery list is empty': 'আপনার বাজারের তালিকা খালি',
  'Snap a meal or add items manually': 'খাবারের ছবি তুলুন অথবা নিজে আইটেম যোগ করুন',
  'items manually': 'আইটেম নিজে যোগ করুন',
  'list': 'তালিকা',
  'empty': 'খালি',
  'Viewing': 'দেখছেন',
  'Clear all': 'সব মুছুন',
  'Clear all grocery items': 'বাজারের সব আইটেম মুছুন',
  'Clear list': 'তালিকা মুছুন',
  'Generate from meals': 'খাবার থেকে তালিকা বানান',
  'Generate grocery items from recent meal pairings': 'সাম্প্রতিক খাবারের তালিকা থেকে বাজারের পণ্য প্রস্তাব করুন',
  'Tap again to confirm': 'নিশ্চিত করতে আবার চাপ দিন',
  'Tap again to confirm clear all': 'সব মুছতে নিশ্চিত করার জন্য আবার চাপ দিন',
  'List cleared': 'তালিকা মুছে ফেলা হয়েছে',
  'List copied to clipboard': 'তালিকা ক্লিপবোর্ডে কপি করা হয়েছে',
  'No pairings found in meal history': 'খাবারের ইতিহাসে কোনো পণ্য খুঁজে পাওয়া যায়নি',
  'All suggested items already in list': 'প্রস্তাবিত সব আইটেম তালিকায় রয়েছে',
  'Please enter an item name': 'দয়া করে আইটেমের নাম লিখুন',
  'Add custom grocery item': 'নিজে বাজারের আইটেম যোগ করুন',
  'Grains & staples': 'শস্য ও প্রধান খাবার',
  'Produce': 'শাকসবজি ও ফলমূল',
  'Pantry': 'রান্নাঘরের সামগ্রী',
  'Checked': 'কেনা হয়েছে',
  'Remaining': 'বাকি',
  'Total': 'মোট',
  'Budget': 'বাজেট',
  'Over budget': 'বাজেট ছাড়িয়েছে',
  'Under budget': 'বাজেটের মধ্যে',
  'Price in taka': 'টাকায় মূল্য',
  'Item name': 'আইটেমের নাম',
  'New item name': 'নতুন আইটেমের নাম',
  'Search grocery items': 'বাজারের পণ্য খুঁজুন',
  'Search foods': 'খাবার খুঁজুন',
  'Search': 'খুঁজুন',
  'Generate list': 'তালিকা তৈরি করুন',
  'Grocery list': 'বাজারের তালিকা',
  'Shopping list': 'কেনাকাটার তালিকা',
  'Add to grocery list': 'বাজারের তালিকায় যোগ করুন',

  // Auth, Admin & PWA
  'Welcome back': 'আবার স্বাগতম',
  'Sign in': 'সাইন ইন',
  'Email': 'ইমেইল',
  'Password': 'পাসওয়ার্ড',
  'Email address': 'ইমেইল ঠিকানা',
  'Enter your email': 'আপনার ইমেইল লিখুন',
  'Enter your password': 'আপনার পাসওয়ার্ড লিখুন',
  'Invalid email or password': 'ইমেইল বা পাসওয়ার্ড সঠিক নয়',
  'Email or password not recognized': 'ইমেইল বা পাসওয়ার্ড সঠিক নয়',
  'Forgot password?': 'পাসওয়ার্ড ভুলে গেছেন?',
  'Show password': 'পাসওয়ার্ড দেখুন',
  'Hide password': 'পাসওয়ার্ড লুকান',
  'Admin': 'অ্যাডমিন',
  'User': 'ব্যবহারকারী',
  'Dashboard': 'ড্যাশবোর্ড',
  'Overview': 'সারসংক্ষেপ',
  'Total users': 'মোট ব্যবহারকারী',
  'Meals analyzed': 'বিশ্লেষণ করা খাবার',
  'Active today': 'আজ সক্রিয়',
  'Users': 'ব্যবহারকারীরা',
  'Top foods': 'জনপ্রিয় খাবার',
  'Popular foods': 'জনপ্রিয় খাবার',
  'Review queue': 'পর্যালোচনা তালিকা',
  'Flagged queue': 'পর্যালোচনা তালিকা',
  'Menu': 'মেনু',
  'Close menu': 'মেনু বন্ধ করুন',
  'Open menu': 'মেনু খুলুন',
  'Admin navigation': 'অ্যাডমিন নেভিগেশন',
  'Admin sections': 'অ্যাডমিন বিভাগ',
  'Sign out of admin': 'অ্যাডমিন থেকে সাইন আউট',
  'Good to see you,': 'আপনাকে দেখে ভালো লাগছে,',
  'Real-time platform activity across registered accounts.': 'নিবন্ধিত সব অ্যাকাউন্টের রিয়েল-টাইম কার্যক্রম।',
  'Meals today': 'আজকের খাবার',
  'across all users': 'সব ব্যবহারকারী মিলিয়ে',
  'Meals this week': 'এই সপ্তাহের খাবার',
  'last 7 days': 'গত ৭ দিন',
  'Avg / user / week': 'ব্যবহারকারীপ্রতি সাপ্তাহিক গড়',
  'registered accounts': 'নিবন্ধিত অ্যাকাউন্ট',
  '7-day meal volume': '৭ দিনের খাবারের পরিমাণ',
  'How many meals landed on each day across all users.': 'সব ব্যবহারকারীর প্রতিদিনের খাবারের সংখ্যা।',
  'Key performance indicators': 'মূল কর্মক্ষমতা সূচক',
  'Flagged detection summary': 'চিহ্নিত শনাক্তকরণের সারসংক্ষেপ',
  'Flagged items': 'চিহ্নিত খাবার',
  'items below 70% confidence': 'টি খাবারের নিশ্চয়তা ৭০%-এর কম',
  'No meals yet': 'এখনো কোনো খাবার নেই',
  'Refresh': 'হালনাগাদ করুন',
  'Last updated': 'সর্বশেষ আপডেট',
  'Search users...': 'ব্যবহারকারী খুঁজুন...',
  'Joined': 'যুক্ত হয়েছেন',
  'Last active': 'সর্বশেষ সক্রিয়',
  'Meals logged': 'নথিভুক্ত খাবার',
  'Streak': 'ধারাবাহিকতা',
  'All time': 'সর্বকাল',
  'Approve': 'অনুমোদন করুন',
  'Correct': 'সংশোধন করুন',
  'No flagged meals in review queue': 'পর্যালোচনা তালিকায় কোনো চিহ্নিত খাবার নেই',
  'Correct food label': 'খাবারের নাম সংশোধন করুন',
  'Save correction': 'সংশোধন সংরক্ষণ করুন',
  'Add to home screen for quick access': 'দ্রুত ব্যবহারের জন্য হোম স্ক্রিনে যোগ করুন',
  'Install NutriVision': 'নিউট্রিভিশন ইনস্টল করুন',
  'Installing…': 'ইনস্টল হচ্ছে…',
  'Install NutriVision AI app': 'নিউট্রিভিশন এআই অ্যাপ ইনস্টল করুন',
  'Install app': 'অ্যাপ ইনস্টল করুন',
  'Install': 'ইনস্টল',
  'Dismiss install banner': 'ইনস্টল ব্যানার বন্ধ করুন',
  'Dismiss': 'বন্ধ করুন',
  'View captured photo': 'তোলা ছবি দেখুন',
  'Loading profile…': 'প্রোফাইল লোড হচ্ছে…',
  'Loading profile...': 'প্রোফাইল লোড হচ্ছে…',
  'Captured meal': 'তোলা খাবার',
  'Camera': 'ক্যামেরা',
  'Gallery': 'গ্যালারি',
  'Switch to light mode': 'লাইট মোড চালু করুন',
  'Switch to dark mode': 'ডার্ক মোড চালু করুন',
  'English': 'English',
  'Step': 'ধাপ',
  'Go to': 'যান',
  'of': 'এর',
  'from history': 'ইতিহাস থেকে',
  'per 100g': 'প্রতি ১০০ গ্রামে',
  'per 100 g': 'প্রতি ১০০ গ্রামে',
  'Something went wrong': 'কিছু একটা সমস্যা হয়েছে',
  'The application hit an unexpected error. You can try again, or reload the page if it keeps happening.': 'অ্যাপ্লিকেশনে অপ্রত্যাশিত সমস্যা হয়েছে। আবার চেষ্টা করুন, অথবা পৃষ্ঠা রিলোড করুন।',

  // Foods (Authentic Bangladeshi & Global)
  'Khichuri': 'খিচুড়ি',
  'Khichuri with egg': 'ডিম দিয়ে খিচুড়ি',
  'khichuri with egg': 'ডিম দিয়ে খিচুড়ি',
  'Bhat': 'ভাত',
  'Rice': 'ভাত',
  'Dal': 'মসুর ডাল',
  'Dal (lentils)': 'মসুর ডাল',
  'Fish curry': 'মাছের তরকারি',
  'Chicken curry': 'মুরগির তরকারি',
  'Chicken biryani': 'চিকেন বিরিয়ানি',
  'Biryani': 'বিরিয়ানি',
  'Beef curry': 'গরুর মাংসের তরকারি',
  'Beef bhuna': 'গরুর ভুনা',
  'Alu bhorta': 'আলু ভর্তা',
  'Aloo bhorta': 'আলু ভর্তা',
  'Aloo Bhorta': 'আলু ভর্তা',
  'Begun Bhorta': 'বেগুন ভর্তা',
  'Ilish Macher Jhol': 'ইলিশ মাছের ঝোল',
  'Lentil Dal': 'মসুর ডাল',
  'Bhorta': 'ভর্তা',
  'Bhaji': 'ভাজি',
  'Shak bhaji': 'শাক ভাজি',
  'Roti': 'রুটি',
  'Paratha': 'পরোটা',
  'Panta bhat': 'পান্তা ভাত',
  'Hilsa curry': 'ইলিশের ঝোল',
  'Ilish': 'ইলিশ মাছ',
  'Cucumber raita': 'শসার রায়তা',
  'Mixed salad': 'মিক্সড সালাদ',
  'Pickled onion': 'পেঁয়াজের আচার',
  'Boiled egg': 'সিদ্ধ ডিম',
  'Grilled chicken': 'গ্রিল করা মুরগি',
  'Steamed broccoli': 'সেদ্ধ ব্রকলি',
  'Whole wheat roti': 'আটার রুটি',
  'Paneer tikka': 'পনির টিক্কা',
  'Greek yogurt': 'গ্রিক দই',
  'Avocado toast': 'অ্যাভোকাডো টোস্ট',
  'Brown rice': 'লাল চালের ভাত',
  'Naan': 'নান',
  'Mint chutney': 'পুদিনার চাটনি',
  'Water': 'পানি',
  'Fruit': 'ফল',
  'Vegetables': 'শাকসবজি',
  'Grains': 'শস্য ও চাল',
  'Chicken Tikka': 'চিকেন টিক্কা',
  'Chicken Korma': 'চিকেন কোরমা',
  'Yogurt dip': 'দইয়ের ডিপ',
  'Tzatziki': 'জাজিকি রায়তা',
  'Greek Salad': 'গ্রিক সালাদ',
  'Garden Salad': 'গার্ডেন সালাদ',
  'Papad': 'পাপড়',
  'Red onion': 'লাল পেঁয়াজ',
  'Shallots': 'ছোট পেঁয়াজ',
  'Olive oil': 'অলিভ অয়েল',
  'Feta cheese': 'ফেটা চিজ',
  'Lemon juice': 'লেবুর রস',
  'Sumac': 'সুমাক',
  'Steamed Basmati Rice': 'বাসমতী চালের ভাত',
  'Red Lentil Dal': 'লাল মসুর ডাল',
  'Cucumber': 'শসা',
  'Spinach': 'পালং শাক',
  'Tomato': 'টমেটো',
  'Eggs (6)': 'ডিম (৬টি)',
  'Chicken breast': 'মুরগির বুকের মাংস',
  'Whole wheat atta': 'আটা',
  'Thai green curry': 'থাই গ্রিন কারি',
  'Pho with rice noodles': 'চাল নুডলসসহ ফো স্যুপ',
  'Dim sum': 'ডিম সাম',
  'Spring rolls': 'স্প্রিং রোল',
  'Bao buns': 'বাও বান',
  'Roasted chicken': 'রোস্ট করা মুরগি',
  'Roast chicken': 'রোস্ট মুরগি',
  'Roasted pork': 'রোস্ট করা শূকরের মাংস',
  'Roasted potatoes': 'রোস্ট করা আলু',
  'Vegetable soup': 'সবজির স্যুপ',
  'Roasted vegetables': 'রোস্ট করা শাকসবজি',
  'Pastry': 'পেস্ট্রি',
  'Tomato salad': 'টমেটোর সালাদ',
  'Grain bowl': 'শস্যের বোল',
  'Yogurt sauce': 'দইয়ের সস',
  'Salad greens': 'সালাদপাতা',
  'Fried eggs': 'ডিম ভাজি',
  'Toast': 'টোস্ট',
  'Waffles with fruit': 'ফলসহ ওয়াফল',
  'Salad': 'সালাদ',
  'Burger': 'বার্গার',
  'Pizza': 'পিজ্জা',
  'French fries': 'ফ্রেঞ্চ ফ্রাই',
  'Fried chicken': 'ফ্রাইড চিকেন',
  'Sandwich': 'স্যান্ডউইচ',
  'Grilled salmon': 'গ্রিল করা স্যামন',
  'Chicken': 'মুরগির মাংস',
  'Rice noodles': 'চালের নুডলস',
  'Mixed vegetables': 'মিশ্র সবজি',
  'Salmon': 'স্যামন মাছ',
  'Broccoli': 'ব্রকলি',
  'Beans': 'শিম',
  'Almonds': 'কাঠবাদাম',
  'Pecans': 'পিকান বাদাম',
  'Quinoa': 'কিনোয়া',
  'Mushrooms': 'মাশরুম',
  'Milk': 'দুধ',
  'Lamb chops': 'খাসির চপ',
  'Meatballs': 'মিটবল',
  'Hummus': 'হুমুস',
  'Crostini': 'ক্রোস্তিনি',
  'Grilled steak': 'গ্রিল করা স্টেক',
  'Roasted lamb chops': 'রোস্ট করা খাসির চপ',
  'Croquettes': 'ক্রোকেট',
  'Potato curry': 'আলুর তরকারি',
  'Fried fish': 'ভাজা মাছ',
  'Sweet': 'মিষ্টি',
  'Chole': 'ছোলার তরকারি',
  'Vegetable curry': 'সবজির তরকারি',
  'Potato patty': 'আলুর প্যাটিস',
  'Puri': 'পুরি',
  'Egg curry': 'ডিমের তরকারি',
  'Paneer curry': 'পনিরের তরকারি',
  'Dum aloo': 'দম আলু',
  'Meat curry': 'মাংসের তরকারি',
  'Rosogolla': 'রসগোল্লা',
  'Payesh': 'পায়েস',

  // Culinary items, cooking media, seasonings & ingredients
  'Salt': 'লবণ',
  'Table salt': 'খাবার লবণ',
  'Black pepper': 'গোলমরিচ',
  'White pepper': 'সাদা গোলমরিচ',
  'Pepper': 'গোলমরিচ',
  'Garlic': 'রসুন',
  'Ginger': 'আদা',
  'Onion': 'পেঁয়াজ',
  'Mustard oil': 'সরিষার তেল',
  'Soybean oil': 'সয়াবিন তেল',
  'Vegetable oil': 'উদ্ভিজ্জ তেল',
  'Sunflower oil': 'সূর্যমুখী তেল',
  'Canola oil': 'ক্যানোলা তেল',
  'Coconut oil': 'নারকেল তেল',
  'Ghee': 'ঘি',
  'Butter': 'মাখন',
  'Turmeric': 'হলুদ',
  'Turmeric powder': 'হলুদ গুঁড়ো',
  'Chili': 'মরিচ',
  'Red chili': 'লাল মরিচ',
  'Green chili': 'কাঁচা মরিচ',
  'Chili powder': 'মরিচের গুঁড়ো',
  'Cumin': 'জিরা',
  'Cumin powder': 'জিরার গুঁড়ো',
  'Coriander': 'ধনে',
  'Coriander leaves': 'ধনেপাতা',
  'Cardamom': 'এলাচ',
  'Cinnamon': 'দারুচিনি',
  'Cloves': 'লবঙ্গ',
  'Bay leaf': 'তেজপাতা',
  'Vinegar': 'ভিনেগার',
  'Soy sauce': 'সয়া সস',
  'Cornstarch': 'কর্নস্টার্চ',
  'Baking powder': 'বেকিং পাউডার',
  'Yeast': 'ইস্ট',
  'Oregano': 'ওরেগানো',
  'Basil': 'তুলসী / ব্যাসিল',
  'Rosemary': 'রোজমেরি',
  'Thyme': 'থাইম',
  'Parsley': 'পার্সলে পাতা',
  'Mint': 'পুদিনা',
  'Garam masala': 'গরম মসলা',
  'Curry powder': 'কারি পাউডার',
  'Penne pasta': 'পেনে পাস্তা',
  'Penne': 'পেনে পাস্তা',
  'Pasta': 'পাস্তা',
  'Spaghetti': 'স্প্যাগেটি',
  'Macaroni': 'ম্যাকারনি',
  'Noodles': 'নুডলস',
  'Grilled Tofu': 'গ্রিলড টোফু',
  'Tofu': 'টোফু',
  'Edamame': 'এডামামে',
  'Sweet Yogurt': 'মিষ্টি দই',
  'Lemon Wedge': 'লেবুর টুকরা',
  'Lemon slice': 'লেবুর টুকরা',
  'Inferred Cooking Media:': 'অনুমানকৃত রান্নার উপাদান:',
  'Inferred Cooking Media': 'অনুমানকৃত রান্নার উপাদান',
  'Inferred cooking media': 'অনুমানকৃত রান্নার উপাদান',
};

const phraseLookup = new Map(
  Object.entries(bnPhrases).map(([english, bengali]) => [english.toLowerCase(), bengali]),
);

const phraseLookupBnToEn = new Map<string, string>();
for (const [english, bengali] of Object.entries(bnPhrases)) {
  const cleanBn = bengali.trim().toLowerCase();
  if (cleanBn && !phraseLookupBnToEn.has(cleanBn)) {
    phraseLookupBnToEn.set(cleanBn, english);
  }
}
// Robust manual canonical aliases for Bengali -> English
phraseLookupBnToEn.set('অলিভ অয়েল', 'Olive Oil');
phraseLookupBnToEn.set('অলিভ অয়েল', 'Olive Oil');
phraseLookupBnToEn.set('লবণ', 'Salt');
phraseLookupBnToEn.set('গোলমরিচ', 'Black Pepper');
phraseLookupBnToEn.set('রসুন', 'Garlic');
phraseLookupBnToEn.set('আদা', 'Ginger');
phraseLookupBnToEn.set('পেঁয়াজ', 'Onion');
phraseLookupBnToEn.set('সরিষার তেল', 'Mustard Oil');
phraseLookupBnToEn.set('সয়াবিন তেল', 'Soybean Oil');
phraseLookupBnToEn.set('ঘি', 'Ghee');
phraseLookupBnToEn.set('মাখন', 'Butter');
phraseLookupBnToEn.set('চিনি', 'Sugar');
phraseLookupBnToEn.set('হলুদ', 'Turmeric');
phraseLookupBnToEn.set('পেনে পাস্তা', 'Penne Pasta');
phraseLookupBnToEn.set('সিদ্ধ ডিম', 'Boiled Egg');
phraseLookupBnToEn.set('মিষ্টি দই', 'Sweet Yogurt');
phraseLookupBnToEn.set('এডামামে', 'Edamame');
phraseLookupBnToEn.set('গ্রিলড টোফু', 'Grilled Tofu');
phraseLookupBnToEn.set('টোফু', 'Tofu');
phraseLookupBnToEn.set('টমেটো', 'Tomato');
phraseLookupBnToEn.set('শসা', 'Cucumber');
phraseLookupBnToEn.set('লেবুর টুকরা', 'Lemon Wedge');
phraseLookupBnToEn.set('ভাত', 'White Rice');
phraseLookupBnToEn.set('মসুর ডাল', 'Red Lentil Dal');
phraseLookupBnToEn.set('খিচুড়ি', 'Khichuri');
phraseLookupBnToEn.set('চিকেন বিরিয়ানি', 'Chicken Biryani');
phraseLookupBnToEn.set('রসগোল্লা', 'Rasgulla');
phraseLookupBnToEn.set('কাঁচা বাজার', 'Produce');
phraseLookupBnToEn.set('শস্য ও চাল', 'Grains');
phraseLookupBnToEn.set('দুধ ও দুগ্ধজাত', 'Dairy');
phraseLookupBnToEn.set('প্রোটিন ও আমিষ', 'Protein');
phraseLookupBnToEn.set('রান্নার উপাদান ও মসলা', 'Pantry');
phraseLookupBnToEn.set('অন্যান্য', 'Other');

const phrasePattern = new RegExp(
  `(^|[^A-Za-z])(${Object.keys(bnPhrases)
    .sort((a, b) => b.length - a.length)
    .map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})(?=$|[^A-Za-z])`,
  'gi',
);

function translateText(value: string): string {
  if (!value) return value;
  const trimmed = value.trim();
  const direct = phraseLookup.get(trimmed.toLowerCase());
  if (direct) {
    const leading = value.match(/^\s*/)?.[0] ?? '';
    const trailing = value.match(/\s*$/)?.[0] ?? '';
    return `${leading}${direct}${trailing}`;
  }
  return value.replace(phrasePattern, (_match, prefix: string, phrase: string) =>
    `${prefix}${phraseLookup.get(phrase.toLowerCase()) ?? phrase}`,
  );
}

function translateToEnglish(value: string): string {
  if (!value) return value;
  const trimmed = value.trim();
  const direct = phraseLookupBnToEn.get(trimmed.toLowerCase());
  if (direct) {
    const leading = value.match(/^\s*/)?.[0] ?? '';
    const trailing = value.match(/\s*$/)?.[0] ?? '';
    return `${leading}${direct}${trailing}`;
  }
  return value;
}

export function translateBengali(value: string): string {
  return translateText(value);
}

export function resolveFoodDisplayName(
  name: string,
  language: Language,
  bengaliName?: string | null,
): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (language === 'bn') {
    if (bengaliName && bengaliName.trim()) return bengaliName.trim();
    const directBn = phraseLookup.get(trimmed.toLowerCase());
    if (directBn) return directBn;
    const canonicalBn = resolveFoodName(trimmed, 'bn');
    if (canonicalBn && canonicalBn.toLowerCase() !== trimmed.toLowerCase()) return canonicalBn;
    return translateText(trimmed);
  }

  const directEn = phraseLookupBnToEn.get(trimmed.toLowerCase());
  if (directEn) return directEn;
  const canonicalEn = resolveFoodName(trimmed, 'en');
  if (canonicalEn && canonicalEn.toLowerCase() !== trimmed.toLowerCase() && !/[\u0980-\u09FF]/.test(canonicalEn)) {
    return canonicalEn;
  }
  if (!/[\u0980-\u09FF]/.test(trimmed)) return trimmed;
  return canonicalEn || trimmed;
}

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  translate: (value: string) => string;
  foodName: (name: string, bengaliName?: string | null) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function initialLanguage(): Language {
  try {
    const saved = window.localStorage.getItem(LANGUAGE_KEY);
    if (saved === 'en' || saved === 'bn') return saved;
    return navigator.language.toLowerCase().startsWith('bn') ? 'bn' : 'en';
  } catch {
    return 'en';
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  const setLanguage = (next: Language) => {
    setLanguageState(next);
    try {
      window.localStorage.setItem(LANGUAGE_KEY, next);
    } catch {
      // The selected language still applies for the current session.
    }
  };

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dataset.language = language;
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      translate: language === 'bn' ? translateText : translateToEnglish,
      foodName: (name, bengaliName) => resolveFoodDisplayName(name, language, bengaliName),
    }),
    [language],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
}

const LOCALIZED_ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt'] as const;

export function LocalizedContent({ children }: { children: ReactNode }) {
  const { language, translate } = useLanguage();

  const localize = (node: ReactNode): ReactNode => {
    if (typeof node === 'string') {
      if (language === 'bn') return translate(node);
      if (language === 'en' && /[\u0980-\u09FF]/.test(node)) return translate(node);
      return node;
    }
    if (Array.isArray(node)) return Children.toArray(node).map(localize);
    if (!isValidElement<{ children?: ReactNode }>(node)) return node;

    const props: Record<string, unknown> = { ...node.props };
    for (const attribute of LOCALIZED_ATTRIBUTES) {
      const value = props[attribute];
      if (typeof value === 'string') {
        if (language === 'bn') props[attribute] = translate(value);
        else if (language === 'en' && /[\u0980-\u09FF]/.test(value)) props[attribute] = translate(value);
      }
    }
    if (node.props.children !== undefined) props.children = localize(node.props.children);
    return cloneElement(node, props);
  };

  return <>{localize(children)}</>;
}
