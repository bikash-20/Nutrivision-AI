import { describe, expect, it } from 'vitest';
import { initialLanguage, resolveFoodDisplayName, translateBengali } from './LanguageContext';

describe('translateBengali', () => {
  it('translates food names without depending on English capitalization', () => {
    expect(translateBengali('khichuri with egg')).toBe('ডিম দিয়ে খিচুড়ি');
  });

  describe('food name localization', () => {
    it('localizes reference-photo foods to Bengali and English', () => {
      const foods: Array<[string, string, string?]> = [
        ['Thai green curry', 'থাই গ্রিন কারি'],
        ['Pho with rice noodles', 'চাল নুডলসসহ ফো স্যুপ'],
        ['Dim sum', 'ডিম সাম'],
        ['Spring rolls', 'স্প্রিং রোল'],
        ['Bao buns', 'বাও বান'],
        ['Roasted chicken', 'রোস্ট করা মুরগি'],
        ['Roast chicken', 'রোস্ট মুরগি'],
        ['Roasted pork', 'রোস্ট করা শূকরের মাংস'],
        ['Roasted potatoes', 'রোস্ট করা আলু'],
        ['Vegetable soup', 'সবজির স্যুপ'],
        ['Roasted vegetables', 'রোস্ট করা শাকসবজি'],
        ['Pastry', 'পেস্ট্রি'],
        ['Tomato salad', 'টমেটোর সালাদ'],
        ['Grain bowl', 'শস্যের বোল'],
        ['Yogurt sauce', 'দইয়ের সস'],
        ['Salad greens', 'সালাদপাতা'],
        ['Fried eggs', 'ডিম ভাজি'],
        ['Toast', 'টোস্ট'],
        ['Waffles with fruit', 'ফলসহ ওয়াফল'],
        ['Salad', 'সালাদ'],
        ['Burger', 'বার্গার'],
        ['Pizza', 'পিজ্জা'],
        ['French fries', 'ফ্রেঞ্চ ফ্রাই'],
        ['Fried chicken', 'ফ্রাইড চিকেন'],
        ['Sandwich', 'স্যান্ডউইচ'],
        ['Grilled salmon', 'গ্রিল করা স্যামন'],
        ['Chicken', 'মুরগির মাংস'],
        ['Rice noodles', 'চালের নুডলস'],
        ['Mixed vegetables', 'মিশ্র সবজি'],
        ['Eggs', 'ডিম'],
        ['Salmon', 'স্যামন মাছ'],
        ['Broccoli', 'ব্রকলি'],
        ['Beans', 'শিম'],
        ['Almonds', 'কাঠবাদাম'],
        ['Pecans', 'পিকান বাদাম'],
        ['Quinoa', 'কিনোয়া'],
        ['Mushrooms', 'মাশরুম'],
        ['Milk', 'দুধ'],
        ['Lamb chops', 'খাসির চপ'],
        ['Meatballs', 'মিটবল'],
        ['Hummus', 'হুমুস'],
        ['Crostini', 'ক্রোস্তিনি'],
        ['Grilled steak', 'গ্রিল করা স্টেক'],
        ['Roasted lamb chops', 'রোস্ট করা খাসির চপ'],
        ['Croquettes', 'ক্রোকেট'],
        ['Paratha', 'পরোটা'],
        ['Chicken curry', 'মুরগির তরকারি'],
        ['Potato curry', 'আলুর তরকারি'],
        ['Rice', 'ভাত', 'White Rice'],
        ['Dal', 'মসুর ডাল', 'Red Lentil Dal'],
        ['Fish curry', 'মাছের তরকারি'],
        ['Fried fish', 'ভাজা মাছ'],
        ['Sweet', 'মিষ্টি'],
        ['Roti', 'রুটি'],
        ['Chole', 'ছোলার তরকারি'],
        ['Vegetable curry', 'সবজির তরকারি'],
        ['Potato patty', 'আলুর প্যাটিস'],
        ['Puri', 'পুরি'],
        ['Egg curry', 'ডিমের তরকারি'],
        ['Paneer curry', 'পনিরের তরকারি'],
        ['Dum aloo', 'দম আলু'],
        ['Meat curry', 'মাংসের তরকারি'],
        ['Rasgulla', 'রসগোল্লা'],
        ['Payesh', 'পায়েস'],
      ];

      for (const [english, bengali, canonicalEnglish = english] of foods) {
        expect(resolveFoodDisplayName(english, 'bn')).toBe(bengali);
        expect(resolveFoodDisplayName(bengali, 'en')).toBe(canonicalEnglish);
      }
      expect(resolveFoodDisplayName('Rosogolla', 'bn')).toBe('রসগোল্লা');
      expect(resolveFoodDisplayName('রসগোল্লা', 'en')).toBe('Rasgulla');
    });

    it('prefers a Bengali name returned with the detection', () => {
      expect(resolveFoodDisplayName('Paneer curry', 'bn', 'পনিরের ঝোল')).toBe('পনিরের ঝোল');
    });

    it('keeps canonical English food names in English mode', () => {
      expect(resolveFoodDisplayName('Paneer curry', 'en')).toBe('Paneer curry');
      expect(resolveFoodDisplayName('দম আলু', 'en')).toBe('Dum aloo');
    });
  });

  it('translates complete phrases but preserves matching text inside other words', () => {
    expect(translateBengali('Other foods are another option.')).toBe(
      'অন্যান্য foods are another option.',
    );
  });

  it('translates labels embedded in accessible and sentence text', () => {
    expect(translateBengali('Search foods')).toBe('খাবার খুঁজুন');
  });

  it('translates profile controls and mixed dynamic hints', () => {
    expect(translateBengali('Toggle High-protein goal')).toBe(
      'পরিবর্তন করুন উচ্চ প্রোটিন লক্ষ্য',
    );
    expect(
      translateBengali(
        'per day — the Grocery screen applies this as a weekly cap of ৳3500 (×7 days)',
      ),
    ).toBe('প্রতিদিন—বাজারের পর্দায় এটি সাপ্তাহিক সীমা হিসেবে প্রয়োগ হয়: ৳3500 (×7 দিন)');
  });

  it('translates the nutrition explanation headings', () => {
    expect(translateBengali('This meal, explained')).toBe('এই খাবারের পুষ্টি বিশ্লেষণ');
    expect(translateBengali('Micronutrients')).toBe('অণুপুষ্টি');
  });

  it('defaults initialLanguage to Bengali (bn) when no saved preference exists', () => {
    expect(initialLanguage()).toBe('bn');
  });
});
