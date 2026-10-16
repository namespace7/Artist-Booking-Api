require("dotenv").config({ quiet: true });

const pool = require("../../src/config/mysql");
const { connectMongo, mongoose } = require("../../src/config/mongo");
const ArtistProfile = require("../../src/models/artist_profile.model");

const SEED_ARTIST_PROFILES = {
  "seed.artist.maya@example.com": {
    bio: "Conservatory-trained jazz vocalist performing swing standards, bossa nova, and modern soul arrangements for private receptions and galas.",
    portfolio: [
      "https://example.com/portfolio/maya-lin-live-quartet",
      "https://example.com/portfolio/maya-lin-rooftop-session",
    ],
    socialLinks: {
      instagram: "https://instagram.com/mayalinjazz",
      website: "https://mayalinmusic.example.com",
    },
    genres: ["Jazz", "Bossa Nova", "Soul"],
    yearsActive: 8,
  },
  "seed.artist.liam@example.com": {
    bio: "Fingerstyle acoustic guitarist specializing in warm instrumental backdrops for intimate weddings, brunches, and acoustic sessions.",
    portfolio: [
      "https://example.com/portfolio/liam-ortega-acoustic-medley",
      "https://example.com/portfolio/liam-ortega-courtyard-set",
    ],
    socialLinks: {
      instagram: "https://instagram.com/liamortegaguitar",
      youtube: "https://youtube.com/@liamortegaguitar",
    },
    genres: ["Acoustic", "Folk", "Instrumental"],
    yearsActive: 5,
  },
};

async function seedArtistProfiles() {
  if (!process.env.MYSQL_DATABASE) {
    throw new Error(
      "MYSQL_DATABASE is not configured. Refusing to seed an unspecified MySQL database.",
    );
  }

  if (!process.env.MONGO_URI) {
    throw new Error(
      "MONGO_URI is not configured. Refusing to seed an unspecified MongoDB database.",
    );
  }

  const seedEmails = Object.keys(SEED_ARTIST_PROFILES);

  try {
    const [rows] = await pool.execute(
      `SELECT id, email, role
       FROM users
       WHERE email IN (?, ?)`,
      seedEmails,
    );

    const rowsByEmail = new Map(rows.map((row) => [row.email, row]));

    for (const email of seedEmails) {
      const user = rowsByEmail.get(email);
      if (!user) {
        throw new Error(
          `Prerequisite seed artist '${email}' not found in MySQL database '${process.env.MYSQL_DATABASE}'. Run sql/seed.sql first.`,
        );
      }
      if (user.role !== "artist") {
        throw new Error(
          `Seed user '${email}' has role '${user.role}', expected 'artist'.`,
        );
      }
    }

    await connectMongo();

    const upsertedUserIds = [];

    for (const email of seedEmails) {
      const user = rowsByEmail.get(email);
      const profileData = SEED_ARTIST_PROFILES[email];

      await ArtistProfile.findOneAndUpdate(
        { userId: user.id },
        {
          $set: {
            userId: user.id,
            bio: profileData.bio,
            portfolio: profileData.portfolio,
            socialLinks: profileData.socialLinks,
            genres: profileData.genres,
            yearsActive: profileData.yearsActive,
          },
        },
        { upsert: true, returnDocument: "after", runValidators: true },
      );

      upsertedUserIds.push(user.id);
    }

    console.log(
      `Seeded ${upsertedUserIds.length} artist profiles in MongoDB for MySQL userIds: ${upsertedUserIds.join(", ")}`,
    );
  } finally {
    await Promise.allSettled([pool.end(), mongoose.disconnect()]);
  }
}

if (require.main === module) {
  seedArtistProfiles().catch((error) => {
    console.error("Artist profile seed failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { seedArtistProfiles, SEED_ARTIST_PROFILES };
