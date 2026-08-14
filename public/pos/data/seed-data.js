/** Realistic demo catalogue: natural cosmetics & Moroccan beauty products. */

export const CATEGORIES = [
  { key: "oils", nameAr: "زيوت طبيعية", nameEn: "Natural Oils", nameFr: "Huiles naturelles" },
  { key: "argan", nameAr: "منتجات الأركان", nameEn: "Argan Products", nameFr: "Produits d'argan" },
  { key: "soap", nameAr: "صابون وحمام", nameEn: "Soap & Hammam", nameFr: "Savon & Hammam" },
  { key: "hair", nameAr: "العناية بالشعر", nameEn: "Hair Care", nameFr: "Soins capillaires" },
  { key: "skin", nameAr: "العناية بالبشرة", nameEn: "Skin Care", nameFr: "Soins de la peau" },
  { key: "clay", nameAr: "الطين والأقنعة", nameEn: "Clay & Masks", nameFr: "Argile & Masques" },
  { key: "perfume", nameAr: "عطور وماء الزهر", nameEn: "Perfumes & Floral Water", nameFr: "Parfums & Eaux florales" },
  { key: "herbs", nameAr: "أعشاب وبخور", nameEn: "Herbs & Incense", nameFr: "Herbes & Encens" },
  { key: "makeup", nameAr: "مستحضرات تجميل", nameEn: "Natural Makeup", nameFr: "Maquillage naturel" },
  { key: "other", nameAr: "أخرى", nameEn: "Other", nameFr: "Autre" },
];

export const BRANDS = [
  { nameAr: "أطلس الطبيعي", nameEn: "Atlas Naturals", nameFr: "Atlas Naturels" },
  { nameAr: "كنوز الصحراء", nameEn: "Sahara Treasures", nameFr: "Trésors du Sahara" },
  { nameAr: "بيت الأركان", nameEn: "Argan House", nameFr: "Maison d'Argan" },
  { nameAr: "عبير فاس", nameEn: "Fes Aroma", nameFr: "Arôme de Fès" },
  { nameAr: "أخرى", nameEn: "Other", nameFr: "Autre" },
];

export const SUPPLIERS = [
  { name: "تعاونية أركان تارودانت", company: "Argan Taroudant Co-op", phone: "+212 528 811 220", email: "contact@argan-taroudant.ma", address: "Zone Industrielle", city: "Taroudant" },
  { name: "مختبرات أطلس", company: "Atlas Labs SARL", phone: "+213 21 45 78 90", email: "sales@atlaslabs.dz", address: "Rue Didouche Mourad", city: "Alger" },
  { name: "أعشاب فاس", company: "Fes Herbs Trading", phone: "+212 535 622 110", email: "info@fesherbs.ma", address: "Medina Fes", city: "Fès" },
  { name: "موزع وهران للتجميل", company: "Oran Beauty Distribution", phone: "+213 41 33 22 11", email: "contact@oranbeauty.dz", address: "Bd de la Soummam", city: "Oran" },
  { name: "صابون مراكش", company: "Marrakech Soap Works", phone: "+212 524 447 889", email: "hello@marrakechsoap.ma", address: "Sidi Ghanem", city: "Marrakech" },
];

export const CUSTOMERS = [
  { name: "أمينة بلقاسم", phone: "+213 661 223 344", email: "amina.b@example.com", address: "حي النصر", city: "Constantine" },
  { name: "Salon Yasmine", phone: "+213 770 118 220", email: "salon.yasmine@example.com", address: "Rue Larbi Ben M'hidi", city: "Alger" },
  { name: "كريم حداد", phone: "+213 555 909 100", email: "karim.haddad@example.com", address: "حي بوعمامة", city: "Sétif" },
  { name: "Pharmacie El Amel", phone: "+213 34 22 11 09", email: "elamel@example.com", address: "Cité 1000 Logements", city: "Béjaïa" },
  { name: "نادية مرزوق", phone: "+213 699 771 552", email: "nadia.m@example.com", address: "حي السلام", city: "Oran" },
  { name: "Institut Nour Beauty", phone: "+213 780 445 660", email: "nour.beauty@example.com", address: "Centre Ville", city: "Blida" },
  { name: "سامية العمري", phone: "+213 662 334 118", email: "samia.a@example.com", address: "حي الرياض", city: "Annaba" },
  { name: "زبون نقدي", phone: "—", email: "", address: "—", city: "—" },
];

/** [nameAr, nameEn, nameFr, category, unit, purchasePrice, sellingPrice, qty, min, max] */
const RAW = [
  ["زيت الأركان العضوي 100 مل", "Organic Argan Oil 100ml", "Huile d'argan bio 100ml", "argan", "bottle", 950, 1750, 64, 15, 120],
  ["زيت الأركان المحمص 50 مل", "Roasted Argan Oil 50ml", "Huile d'argan torréfiée 50ml", "argan", "bottle", 620, 1180, 12, 15, 100],
  ["كريم الأركان للجسم", "Argan Body Cream", "Crème corporelle argan", "argan", "jar", 780, 1490, 5, 12, 80],
  ["شامبو الأركان بدون سلفات", "Argan Sulfate-Free Shampoo", "Shampoing argan sans sulfate", "hair", "bottle", 640, 1250, 38, 10, 90],
  ["زيت الزيتون البكر للعناية", "Virgin Olive Care Oil", "Huile d'olive vierge soin", "oils", "bottle", 420, 820, 96, 20, 150],
  ["زيت النيلة الزرقاء", "Blue Nila Oil", "Huile de Nila bleue", "oils", "bottle", 510, 990, 0, 10, 60],
  ["زيت حبة البركة", "Black Seed Oil", "Huile de nigelle", "oils", "bottle", 380, 760, 44, 12, 90],
  ["زيت اللوز الحلو", "Sweet Almond Oil", "Huile d'amande douce", "oils", "bottle", 460, 890, 27, 15, 100],
  ["زيت جوز الهند البكر", "Virgin Coconut Oil", "Huile de coco vierge", "oils", "jar", 540, 1050, 8, 12, 70],
  ["الصابون البلدي الأصلي", "Traditional Beldi Soap", "Savon beldi traditionnel", "soap", "jar", 210, 450, 130, 25, 200],
  ["صابون الغار الحلبي", "Aleppo Laurel Soap", "Savon d'Alep au laurier", "soap", "piece", 180, 390, 74, 20, 160],
  ["كيس الحمام المغربي", "Moroccan Hammam Kit", "Kit hammam marocain", "soap", "kit", 890, 1690, 16, 10, 60],
  ["ليفة كيس الحمام", "Kessa Exfoliating Glove", "Gant de kessa", "soap", "piece", 90, 220, 210, 30, 250],
  ["الغاسول البركاني", "Volcanic Rhassoul Clay", "Rhassoul volcanique", "clay", "bag", 250, 520, 58, 20, 140],
  ["طين البنتونيت النقي", "Pure Bentonite Clay", "Argile bentonite pure", "clay", "bag", 230, 480, 3, 15, 110],
  ["قناع الغاسول بالورد", "Rhassoul Rose Mask", "Masque rhassoul à la rose", "clay", "jar", 340, 690, 22, 12, 80],
  ["ماء الورد الدمشقي", "Damask Rose Water", "Eau de rose de Damas", "perfume", "bottle", 300, 620, 66, 18, 120],
  ["ماء زهر البرتقال", "Orange Blossom Water", "Eau de fleur d'oranger", "perfume", "bottle", 290, 590, 41, 18, 120],
  ["عطر المسك الأبيض", "White Musk Perfume", "Parfum musc blanc", "perfume", "bottle", 700, 1390, 19, 10, 70],
  ["عود مغربي معطر", "Moroccan Scented Oud", "Oud marocain parfumé", "herbs", "box", 1200, 2350, 11, 8, 40],
  ["حنة طبيعية للشعر", "Natural Hair Henna", "Henné naturel cheveux", "hair", "bag", 160, 340, 88, 25, 180],
  ["بلسم الشعر بالصبار", "Aloe Hair Conditioner", "Conditionneur aloe", "hair", "bottle", 520, 1020, 7, 12, 80],
  ["سيروم نمو الشعر بالخروع", "Castor Hair Growth Serum", "Sérum capillaire ricin", "hair", "bottle", 600, 1180, 33, 10, 70],
  ["كريم النهار بفيتامين سي", "Vitamin C Day Cream", "Crème de jour vitamine C", "skin", "jar", 830, 1620, 25, 12, 80],
  ["سيروم حمض الهيالورونيك", "Hyaluronic Acid Serum", "Sérum acide hyaluronique", "skin", "bottle", 990, 1890, 14, 10, 60],
  ["مقشر السكر بالقرفة", "Cinnamon Sugar Scrub", "Gommage sucre cannelle", "skin", "jar", 380, 780, 47, 15, 100],
  ["مرطب الشفاه بزبدة الشيا", "Shea Lip Balm", "Baume à lèvres karité", "skin", "piece", 120, 290, 156, 30, 220],
  ["زبدة الشيا الخام", "Raw Shea Butter", "Beurre de karité brut", "skin", "jar", 450, 920, 2, 15, 110],
  ["كحل العربي الطبيعي", "Natural Arabic Kohl", "Khôl arabe naturel", "makeup", "piece", 190, 420, 62, 20, 140],
  ["أحمر شفاه بزيت الأركان", "Argan Oil Lipstick", "Rouge à lèvres argan", "makeup", "piece", 430, 890, 36, 15, 100],
  ["مسكارا نباتية", "Vegan Mascara", "Mascara vegan", "makeup", "piece", 470, 950, 18, 12, 80],
  ["أعشاب السدر للشعر", "Sidr Leaf Hair Powder", "Poudre de sidr", "herbs", "bag", 170, 360, 51, 20, 150],
  ["شاي الأعشاب المنقي", "Detox Herbal Tea", "Thé détox aux herbes", "herbs", "box", 240, 500, 29, 15, 100],
  ["مسك الطهارة الطبيعي", "Natural Solid Musk", "Musc solide naturel", "perfume", "piece", 260, 550, 9, 12, 70],
  ["علبة هدايا الجمال المغربي", "Moroccan Beauty Gift Box", "Coffret beauté marocaine", "other", "box", 1600, 2990, 6, 5, 30],
];

export const PRODUCTS = RAW.map(([nameAr, nameEn, nameFr, category, unit, purchasePrice, sellingPrice, quantity, minimumStock, maximumStock], i) => ({
  nameAr,
  nameEn,
  nameFr,
  category,
  unit,
  purchasePrice,
  sellingPrice,
  quantity,
  minimumStock,
  maximumStock,
  reorderPoint: Math.round(minimumStock * 1.4),
  sku: `NC-${String(i + 1).padStart(4, "0")}`,
  barcode: `61300${String(100000 + i * 37).slice(0, 6)}${(i % 9) + 1}`,
  status: i === 5 ? "active" : i === 33 ? "inactive" : "active",
}));
