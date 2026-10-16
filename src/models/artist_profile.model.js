const { mongoose } = require("../config/mongo");

// artist_profiles holds MongoDB-native document data for an artist: bio,
// portfolio, social links, and any other flexible profile attributes that
// do not need relational constraints or joins.
//
// userId references users.id in MySQL at the APPLICATION level only.
// MongoDB cannot enforce a foreign key against a MySQL table -- there is no
// cross-database referential integrity here. Any invariant such as "userId
// must correspond to an existing artist-role user in MySQL" must be
// enforced in application code (e.g. in whatever service eventually reads
// or writes this model), not by the database.
//
// Scope note: this model is intentionally not wired to any route,
// controller, or service in this phase. No new endpoint is added and no
// existing response shape changes. See README.md for the documented
// rationale (profile CRUD is outside the four required endpoints).
const artistProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: Number,
      required: true,
      unique: true,
    },

    bio: {
      type: String,
      default: "",
      maxlength: 2000,
    },

    portfolio: {
      type: [String],
      default: [],
    },

    socialLinks: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: "artist_profiles",
    // strict: false allows additional, unspecified profile fields beyond
    // the ones declared above -- appropriate for a document-oriented,
    // flexible artist-profile design rather than a rigid relational shape.
    strict: false,
  },
);

// `unique: true` on the userId field definition above already creates a
// unique index; no separate .index() call is declared here to avoid
// registering the same index twice.

module.exports =
  mongoose.models.ArtistProfile ||
  mongoose.model("ArtistProfile", artistProfileSchema);
