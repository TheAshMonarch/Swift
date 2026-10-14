import 'dotenv/config'; // load .env before anything reads process.env
import mongoose from 'mongoose';
import * as bcrypt from 'bcrypt';

// --- CONFIGURATION ---
const MONGO_URI: string | undefined = process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error('Seeder aborted: MONGODB_URI is not set (check your .env).');
  process.exit(1);
}

// SAFETY: refuse to wipe a production database. The seeder deletes ALL users.
const looksLikeProd = /prod|atlas|cluster/i.test(MONGO_URI);
if (looksLikeProd && process.env.ALLOW_PROD_SEED !== 'true') {
  console.error(
    'Seeder aborted: MONGODB_URI looks like a production database.\n' +
      'Set ALLOW_PROD_SEED=true to override (double-check the URI first).',
  );
  process.exit(1);
}

// --- SCHEMAS (Mimicking NestJS models to avoid bootstrap overhead) ---
const LocationSchema = new mongoose.Schema({
  type: { type: String, enum: ['Point'], default: 'Point', required: true },
  coordinates: { type: [Number], required: true }, // [longitude, latitude]
}, { _id: false });

const ProProfileSchema = new mongoose.Schema({
  category: { type: String, required: true },
  skills: { type: [String], default: [] },
  hourlyRate: { type: Number, required: true, min: 0 },
  averageRating: { type: Number, default: 0, min: 0, max: 5 },
  isBadgeVerified: { type: Boolean, default: false },
  reviewCount: { type: Number, default: 0 },
  completedJobs: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
}, { _id: false });

const WorkPhotoSchema = new mongoose.Schema({
  url: { type: String, required: true },
  publicId: { type: String, required: true },
});

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['seeker', 'professional', 'admin'], required: true },
  isVerified: { type: Boolean, default: false },
  location: { type: LocationSchema, required: true },
  proProfile: { type: ProProfileSchema, required: false },
  avatar: { type: String, required: false },
  workPhotos: { type: [WorkPhotoSchema], default: undefined },
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);

// --- SEED SELECTION DATA ---
const PASSWORD_PLAIN = 'password123';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD_PLAIN, 10);

// Reference Uyo coordinates for realistic proximity searches [longitude, latitude]
const BASE_LNG = Number(process.env.SEED_BASE_LNG ?? 7.9128);
const BASE_LAT = Number(process.env.SEED_BASE_LAT ?? 5.0377);

// Helper to jitter coordinates slightly for distinct physical spots
const getRandomCoordinatesOffset = (distanceInKm: number): [number, number] => {
  const degreeOffset = distanceInKm / 111; // ~111km per coordinate degree
  const lngOffset = (Math.random() - 0.5) * degreeOffset;
  const latOffset = (Math.random() - 0.5) * degreeOffset;
  return [parseFloat((BASE_LNG + lngOffset).toFixed(6)), parseFloat((BASE_LAT + latOffset).toFixed(6))];
};

const mockUsers = [
  // ================= ADMIN =================
  {
    name: "Artiz Administrator",
    email: "admin@artiz.com",
    phone: "+2348000000000",
    passwordHash: PASSWORD_HASH,
    role: "admin",
    isVerified: true,
    location: { type: "Point", coordinates: [BASE_LNG, BASE_LAT] },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Admin",
  },

  // ================= SEEKERS (CLIENTS) =================
  {
    name: "Emem Udoh",
    email: "emem@artiz.com",
    phone: "+2348011111111",
    passwordHash: PASSWORD_HASH,
    role: "seeker",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(0.8) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Emem",
  },
  {
    name: "Anietie Benson",
    email: "anietie@artiz.com",
    phone: "+2348022222222",
    passwordHash: PASSWORD_HASH,
    role: "seeker",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(1.5) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Anietie",
  },
  {
    name: "Kufre Ukpong",
    email: "kufre@artiz.com",
    phone: "+2348023333333",
    passwordHash: PASSWORD_HASH,
    role: "seeker",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(2.2) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Kufre",
  },
  {
    name: "Blessing Okon",
    email: "blessing@artiz.com",
    phone: "+2348024444444",
    passwordHash: PASSWORD_HASH,
    role: "seeker",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(3.1) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Blessing",
  },
  {
    name: "Tunde Bakare",
    email: "tunde@artiz.com",
    phone: "+2348025555555",
    passwordHash: PASSWORD_HASH,
    role: "seeker",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(1.2) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Tunde",
  },
  {
    name: "Chioma Eze",
    email: "chioma@artiz.com",
    phone: "+2348026666666",
    passwordHash: PASSWORD_HASH,
    role: "seeker",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(2.7) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Chioma",
  },

  // ================= PROFESSIONALS (ARTISANS & EXPERTS) =================
  {
    name: "Bassey Ekong",
    email: "bassey@artiz.com",
    phone: "+2348033333333",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(0.6) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Bassey",
    proProfile: {
      category: "Plumbing",
      skills: ["Leak Repair", "Drain Unblocking", "Piping Installation", "Water Heater Setup"],
      hourlyRate: 4500,
      averageRating: 4.8,
      isBadgeVerified: true,
      reviewCount: 32,
      completedJobs: 41,
      totalEarnings: 365000,
    },
    workPhotos: [
      {
        url: "https://images.unsplash.com/photo-1585704032915-c3400ca199e7?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-plumbing-1",
      },
      {
        url: "https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-plumbing-2",
      },
    ],
  },
  {
    name: "Nsikak Effiong",
    email: "nsikak@artiz.com",
    phone: "+2348044444444",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(1.2) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Nsikak",
    proProfile: {
      category: "Electrical Wiring",
      skills: ["Conduit Wiring", "Inverter Installation", "Distribution Board Repair", "Fault Tracing"],
      hourlyRate: 6000,
      averageRating: 4.9,
      isBadgeVerified: true,
      reviewCount: 54,
      completedJobs: 62,
      totalEarnings: 744000,
    },
    workPhotos: [
      {
        url: "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-electrical-1",
      },
      {
        url: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-electrical-2",
      },
    ],
  },
  {
    name: "Idara Akpan",
    email: "idara@artiz.com",
    phone: "+2348055555555",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(1.8) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Idara",
    proProfile: {
      category: "Hair Styling & Barbering",
      skills: ["Locs Styling", "Wig Installation", "Braiding", "Hair Treatment"],
      hourlyRate: 3500,
      averageRating: 4.7,
      isBadgeVerified: false,
      reviewCount: 19,
      completedJobs: 24,
      totalEarnings: 168000,
    },
    workPhotos: [
      {
        url: "https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-hair-1",
      },
      {
        url: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-hair-2",
      },
    ],
  },
  {
    name: "Victor Ituen",
    email: "victor@artiz.com",
    phone: "+2348066666666",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(3.4) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Victor",
    proProfile: {
      category: "AC & Refrigeration Repair",
      skills: ["Gas Refilling", "Compressor Replacement", "AC Servicing", "Leak Detection"],
      hourlyRate: 7500,
      averageRating: 4.8,
      isBadgeVerified: true,
      reviewCount: 28,
      completedJobs: 33,
      totalEarnings: 495000,
    },
    workPhotos: [
      {
        url: "https://images.unsplash.com/photo-1621905252507-b35492cc74b4?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-ac-1",
      },
    ],
  },
  {
    name: "Uduak Archibong",
    email: "uduak@artiz.com",
    phone: "+2348077777777",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(2.5) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Uduak",
    proProfile: {
      category: "Generator Repair",
      skills: ["Coil Rewinding", "Carburetor Servicing", "Diesel Engine Repair", "Soundproof Gen Maintenance"],
      hourlyRate: 5000,
      averageRating: 4.6,
      isBadgeVerified: false,
      reviewCount: 15,
      completedJobs: 18,
      totalEarnings: 180000,
    },
    workPhotos: [
      {
        url: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-gen-1",
      },
    ],
  },
  {
    name: "Mfoniso Asuquo",
    email: "mfoniso@artiz.com",
    phone: "+2348088888888",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(1.1) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Mfoniso",
    proProfile: {
      category: "Solar & Inverter Tech",
      skills: ["Solar Sizing", "Lithium Battery Setup", "Pure Sine Inverter Wiring", "Solar Pump Systems"],
      hourlyRate: 12000,
      averageRating: 5.0,
      isBadgeVerified: true,
      reviewCount: 41,
      completedJobs: 49,
      totalEarnings: 1176000,
    },
    workPhotos: [
      {
        url: "https://images.unsplash.com/photo-1509391365360-2e959784a276?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-solar-1",
      },
      {
        url: "https://images.unsplash.com/photo-1508873696983-2df5293cb395?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-solar-2",
      },
    ],
  },
  {
    name: "Ekemini Bassey",
    email: "ekemini@artiz.com",
    phone: "+2348099999999",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(2.0) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Ekemini",
    proProfile: {
      category: "Tailoring & Fashion Design",
      skills: ["Senator Suits", "Agbada Tailoring", "Bridal Gowns", "Pattern Drafting"],
      hourlyRate: 5500,
      averageRating: 4.9,
      isBadgeVerified: true,
      reviewCount: 38,
      completedJobs: 46,
      totalEarnings: 506000,
    },
    workPhotos: [
      {
        url: "https://images.unsplash.com/photo-1558769132-cb1aea458c5e?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-tailor-1",
      },
    ],
  },
  {
    name: "Samuel Udoh",
    email: "samuel@artiz.com",
    phone: "+2348101112222",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(1.6) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Samuel",
    proProfile: {
      category: "Carpentry & Woodworking",
      skills: ["Kitchen Cabinetry", "Wardrobes", "Door Hanging", "Roof Trusses"],
      hourlyRate: 6500,
      averageRating: 4.8,
      isBadgeVerified: true,
      reviewCount: 25,
      completedJobs: 30,
      totalEarnings: 390000,
    },
    workPhotos: [
      {
        url: "https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-carpentry-1",
      },
    ],
  },
  {
    name: "Mercy Inyang",
    email: "mercy@artiz.com",
    phone: "+2348112223333",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(0.9) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Mercy",
    proProfile: {
      category: "Makeup & Gele Styling",
      skills: ["Bridal Glam", "Traditional Gele Tying", "Editorial Makeup", "Skin Prepping"],
      hourlyRate: 8000,
      averageRating: 4.9,
      isBadgeVerified: true,
      reviewCount: 33,
      completedJobs: 40,
      totalEarnings: 640000,
    },
    workPhotos: [
      {
        url: "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-makeup-1",
      },
    ],
  },
  {
    name: "Godwin Ekanem",
    email: "godwin@artiz.com",
    phone: "+2348123334444",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(4.2) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Godwin",
    proProfile: {
      category: "Auto Mechanics & Diagnostics",
      skills: ["OBD-II Computer Scan", "Brake Overhaul", "Engine Diagnostics", "Transmission Servicing"],
      hourlyRate: 7000,
      averageRating: 4.7,
      isBadgeVerified: true,
      reviewCount: 21,
      completedJobs: 27,
      totalEarnings: 378000,
    },
    workPhotos: [
      {
        url: "https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-mechanic-1",
      },
    ],
  },
  {
    name: "Blessing Sunday",
    email: "blessings@artiz.com",
    phone: "+2348134445555",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(1.4) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=BlessingS",
    proProfile: {
      category: "Cleaning & Janitorial",
      skills: ["Deep Cleaning", "Post-Construction Clean", "Fumigation", "Upholstery Steaming"],
      hourlyRate: 4000,
      averageRating: 4.6,
      isBadgeVerified: false,
      reviewCount: 16,
      completedJobs: 20,
      totalEarnings: 160000,
    },
    workPhotos: [
      {
        url: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-cleaning-1",
      },
    ],
  },
  {
    name: "Imo Etuk",
    email: "imo@artiz.com",
    phone: "+2348145556666",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(2.9) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Imo",
    proProfile: {
      category: "Painting & POP",
      skills: ["POP Ceiling Design", "Screeding", "Exterior Emulsion", "Gloss Coating"],
      hourlyRate: 5000,
      averageRating: 4.8,
      isBadgeVerified: true,
      reviewCount: 29,
      completedJobs: 36,
      totalEarnings: 360000,
    },
    workPhotos: [
      {
        url: "https://images.unsplash.com/photo-1589939705384-5185137a7f0f?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-painting-1",
      },
    ],
  },
  {
    name: "Ubong Etim",
    email: "ubong@artiz.com",
    phone: "+2348156667777",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(3.8) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Ubong",
    proProfile: {
      category: "Welding & Metal Fabrication",
      skills: ["Burglar Proofing", "Iron Gates", "Handrails", "Structural Steel Welding"],
      hourlyRate: 6000,
      averageRating: 4.5,
      isBadgeVerified: false,
      reviewCount: 12,
      completedJobs: 15,
      totalEarnings: 180000,
    },
    workPhotos: [
      {
        url: "https://images.unsplash.com/photo-1504917599217-d4dc5ebe6122?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-welding-1",
      },
    ],
  },
  {
    name: "David Okon",
    email: "david@artiz.com",
    phone: "+2348167778888",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(1.3) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=David",
    proProfile: {
      category: "CCTV Installation",
      skills: ["IP Camera Setup", "NVR Configuration", "Remote Phone Streaming", "Biometric Access Control"],
      hourlyRate: 8500,
      averageRating: 4.9,
      isBadgeVerified: true,
      reviewCount: 36,
      completedJobs: 42,
      totalEarnings: 714000,
    },
    workPhotos: [
      {
        url: "https://images.unsplash.com/photo-1557597774-9d273605dfa9?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-cctv-1",
      },
    ],
  },
  {
    name: "Ini-Obong Umoh",
    email: "iniobong@artiz.com",
    phone: "+2348178889999",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(2.4) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=IniObong",
    proProfile: {
      category: "Masonry & Tiling",
      skills: ["Porcelain Floor Tiling", "Granite Kitchen Tops", "Interlocking Stones", "Wall Screeding"],
      hourlyRate: 5500,
      averageRating: 4.7,
      isBadgeVerified: true,
      reviewCount: 23,
      completedJobs: 28,
      totalEarnings: 308000,
    },
    workPhotos: [
      {
        url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-tiling-1",
      },
    ],
  },
  {
    name: "Ndifreke Essien",
    email: "ndifreke@artiz.com",
    phone: "+2348189990000",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(3.0) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Ndifreke",
    proProfile: {
      category: "Electronics Repair",
      skills: ["Smart TV Screen Repair", "Power Supply Overhaul", "Motherboard Micro-soldering", "Audio Amplifiers"],
      hourlyRate: 4500,
      averageRating: 4.8,
      isBadgeVerified: false,
      reviewCount: 18,
      completedJobs: 22,
      totalEarnings: 198000,
    },
    workPhotos: [
      {
        url: "https://images.unsplash.com/photo-1588508065123-287b28e013da?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-electronics-1",
      },
    ],
  },
  {
    name: "Faith Benson",
    email: "faith@artiz.com",
    phone: "+2348190001111",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(1.7) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Faith",
    proProfile: {
      category: "Event Decoration & Catering",
      skills: ["Stage Decoration", "Small Chops Catering", "Balloon Styling", "Lighting & Ambience"],
      hourlyRate: 10000,
      averageRating: 5.0,
      isBadgeVerified: true,
      reviewCount: 45,
      completedJobs: 52,
      totalEarnings: 1040000,
    },
    workPhotos: [
      {
        url: "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=800&q=80",
        publicId: "seed-event-1",
      },
    ],
  },
];

// --- SEED FUNCTION ---
async function runSeed() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI!);
  console.log(' Connected.');

  const hashOk = await bcrypt.compare(PASSWORD_PLAIN, PASSWORD_HASH);
  if (!hashOk) {
    console.error('Seeder aborted: PASSWORD_HASH does not match PASSWORD_PLAIN.');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(' Clearing existing users...');
  await User.deleteMany({});
  console.log(' Collection cleared.');

  console.log(' Planting mock users...');
  const inserted = await User.insertMany(mockUsers);
  console.log(` Successfully seeded ${inserted.length} users into the database!`);

  // Ensure 2dsphere index is built for geospatial query compatibility
  console.log(' Ensuring 2dsphere index on location...');
  await User.collection.createIndex({ location: "2dsphere" });
  console.log(' Geospatial indexing active.');

  await mongoose.disconnect();
  console.log(' Seeder complete. Disconnected from DB.');
}

runSeed().catch((err) => {
  console.error('❌ Seeder failed with error:', err);
  process.exit(1);
});