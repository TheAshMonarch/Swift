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

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['seeker', 'professional', 'admin'], required: true },
  isVerified: { type: Boolean, default: false },
  location: { type: LocationSchema, required: true },
  proProfile: { type: ProProfileSchema, required: false },
  avatar: { type: String, required: false }
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);

// --- SEED SELECTION DATA ---
// Pre-calculated bcrypt hash for "password123" — verified at runtime below.
const PASSWORD_HASH = '$2b$10$oX1yL3b9oZ54hZgK4rRMe.PZ61Uf.V.vWn/E0AOfkSszH/5j5U4z2';
const PASSWORD_PLAIN = 'password123';

// Reference Uyo coordinates for realistic proximity searches [longitude, latitude]
// Overridable via env so the seeder can target other cities.
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
  // --- SEEKERS ---
  {
    name: "Emem Udoh",
    email: "emem@artiz.com",
    phone: "+2348011111111",
    passwordHash: PASSWORD_HASH,
    role: "seeker",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(1) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Emem"
  },
  {
    name: "Anietie Benson",
    email: "anietie@artiz.com",
    phone: "+2348022222222",
    passwordHash: PASSWORD_HASH,
    role: "seeker",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(2) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Anietie"
  },
  
  // --- PROFESSIONALS ---
  {
    name: "Bassey Ekong",
    email: "bassey@artiz.com",
    phone: "+2348033333333",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(0.5) }, // Very close!
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Bassey",
    proProfile: {
      category: "Plumbing",
      skills: ["Leak Repair", "Drain Unblocking", "Piping Installation", "Water Heater Setup"],
      hourlyRate: 15,
      averageRating: 4.8,
      isBadgeVerified: true,
      reviewCount: 24,
      completedJobs: 31,
      totalEarnings: 465
    }
  },
  {
    name: "Nsikak Effiong",
    email: "nsikak@artiz.com",
    phone: "+2348044444444",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(3.2) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Nsikak",
    proProfile: {
      category: "Electrical Wiring",
      skills: ["Conduit Wiring", "Inverter Installation", "Distribution Board Repair", "Fault Tracing"],
      hourlyRate: 25,
      averageRating: 4.9,
      isBadgeVerified: true,
      reviewCount: 42,
      completedJobs: 50,
      totalEarnings: 1250
    }
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
      hourlyRate: 18,
      averageRating: 4.7,
      isBadgeVerified: false,
      reviewCount: 15,
      completedJobs: 18,
      totalEarnings: 324
    }
  },
  {
    name: "Victor Ituen",
    email: "victor@artiz.com",
    phone: "+2348066666666",
    passwordHash: PASSWORD_HASH,
    role: "professional",
    isVerified: true,
    location: { type: "Point", coordinates: getRandomCoordinatesOffset(5.0) },
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Victor",
    proProfile: {
      category: "AC & Refrigeration Repair",
      skills: ["Gas Refilling", "Compressor Replacement", "AC Servicing", "Leak Detection"],
      hourlyRate: 30,
      averageRating: 4.5,
      isBadgeVerified: true,
      reviewCount: 19,
      completedJobs: 22,
      totalEarnings: 660
    }
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
      hourlyRate: 20,
      averageRating: 4.6,
      isBadgeVerified: false,
      reviewCount: 8,
      completedJobs: 11,
      totalEarnings: 220
    }
  }
];

// --- SEED FUNCTION ---
async function runSeed() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI!);
  console.log('Connected.');

  // Verify the hardcoded hash actually matches the advertised password,
  // so seeded logins never silently break from a stale hash.
  const hashOk = await bcrypt.compare(PASSWORD_PLAIN, PASSWORD_HASH);
  if (!hashOk) {
    console.error('Seeder aborted: PASSWORD_HASH does not match PASSWORD_PLAIN. Regenerate it.');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(' Clearing existing users...');
  await User.deleteMany({});
  console.log(' Collection cleared.');

  console.log('Planting mock users...');
  const inserted = await User.insertMany(mockUsers);
  console.log(`Successfully seeded ${inserted.length} users into the database!`);

  // Ensure 2dsphere index is built for geospatial query compatibility
  console.log(' Ensuring 2dsphere index on location...');
  await User.collection.createIndex({ location: "2dsphere" });
  console.log(' Geospatial indexing active.');

  await mongoose.disconnect();
  console.log('Seeder complete. Disconnected from DB.');
}

runSeed().catch((err) => {
  console.error(' Seeder failed with error:', err);
  process.exit(1);
});