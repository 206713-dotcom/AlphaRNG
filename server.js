/*
  AlphaRNG live backend

  Run with:
    node server.js

  Optional environment variables:
    PORT=4173
    GEMINI_API_KEY=your_google_ai_studio_key
    GEMINI_MODEL=gemini-flash-lite-latest
    GEMINI_TIMEOUT_MS=5500
    RESEND_API_KEY=your_resend_key
    TWO_FACTOR_FROM_EMAIL=AlphaRNG <noreply@yourdomain.com>
    SMTP_HOST=smtp.gmail.com
    SMTP_PORT=465
    SMTP_USER=sender@example.com
    SMTP_PASS=your_smtp_or_app_password
    SMTP_FROM=AlphaRNG <sender@example.com>
    RETURN_DEV_MAGIC_LINKS=true
    RETURN_DEV_2FA_CODES=true

  This backend intentionally keeps secrets server-side. The browser never sees
  the Gemini API key, magic-link tokens after login, session tokens, or email
  provider key.
*/

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const tls = require("tls");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "alpharng-db.json");
const PUBLIC_FILES = new Set(["/index.html", "/style.css", "/script.js", "/favicon.ico"]);
const SESSION_COOKIE = "alpharng_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const TWO_STEP_TTL_MS = 1000 * 60 * 10;
const MAGIC_LINK_TTL_MS = 1000 * 60 * 15;
const BASE_GLYPHS = 25;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const VOWELS = new Set(["A", "E", "I", "O", "U"]);
const ADMIN_EMAILS = new Set(["206713@gardenschool.edu.my"]);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 5500);
const GEMINI_CACHE_TTL_MS = Number(process.env.GEMINI_CACHE_TTL_MS || 1000 * 60 * 60);
const GEMINI_CACHE_MAX = Number(process.env.GEMINI_CACHE_MAX || 500);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 256_000);
const ACTIVE_UPGRADE_IDS = new Set([
  "bigger_sequence",
  "sequence_expander_2",
  "number_sequence_1",
  "number_sequence_2",
  "number_sequence_3",
]);

const TIER_ORDER = ["trash", "common", "uncommon", "rare", "epic", "legendary", "mythic", "glitched"];
const geminiCache = new Map();
const rateBuckets = new Map();

const RARITIES = {
  common: { label: "Common", rank: 1 },
  uncommon: { label: "Uncommon", rank: 2 },
  rare: { label: "Rare", rank: 3 },
  epic: { label: "Epic", rank: 4 },
  legendary: { label: "Legendary", rank: 5 },
  mythic: { label: "Mythic", rank: 6 },
  glitched: { label: "Glitched", rank: 7 },
};

const PROBABILITY_RARITY_BANDS = [
  { rarity: "glitched", maxChance: 0.00001 },
  { rarity: "mythic", maxChance: 0.00015 },
  { rarity: "legendary", maxChance: 0.001 },
  { rarity: "epic", maxChance: 0.01 },
  { rarity: "rare", maxChance: 0.05 },
  { rarity: "uncommon", maxChance: 0.2 },
  { rarity: "common", maxChance: 1 },
];

const FALLBACK_CHANCE_BY_RARITY = {
  common: 0.35,
  uncommon: 0.12,
  rare: 0.035,
  epic: 0.006,
  legendary: 0.0007,
  mythic: 0.00008,
  glitched: 0.000005,
};

const MANUAL_BADGE_DROP_CHANCES = {
  glitched_roll: 0.0015,
  luck_surge: 0.018,
  mythic_pulse: 0.0008,
  cosmic_jackpot: 0.00035,
  reality_rift: 0.00006,
  abyssal_jackpot: 0.000012,
};

// Only badges in this set, or generated badges with exact metadata
// (relicWord / fragment / pattern / sigmaTarget), are allowed to display
// precise percentages. Everything else uses a non-percent label so the UI
// never pretends sampled, AI, dictionary, random, or partial-condition odds
// are exact.
const EXACT_FORMULA_BADGE_IDS = new Set([
  "double_trouble",
  "triple_threat",
  "quad_core",
  "alphabet_king",
  "vowel_storm",
  "no_vowels",
  "abc_run",
  "reverse_run",
  "palindrome",
  "keyboard_chaos",
  "lucky_seven",
  "high_alphabet",
  "low_alphabet",
  "edge_case",
  "mirror_pair",
  "fivefold_signal",
  "bookends",
  "rare_letter",
  "rare_cluster",
  "q_without_u",
  "x_marks",
  "zed_zone",
  "balanced_scale",
  "perfect_hundred",
  "alpha_sum_50",
  "alpha_sum_77",
  "alpha_sum_111",
  "golden_sigma",
  "perfect_sigma",
  "vowel_crown",
  "consonant_wall",
  "all_low_wall",
  "all_high_skyline",
  "vowel_singularity_6",
  "compact_core_4",
  "bridge_frame_5",
  "sixfold_crown",
  "starter_mirror_4",
  "centerpiece_5",
  "hex_mirror",
  "quad_singularity",
  "penta_singularity",
  "perfect_hex_singularity",
  "aether_monolith",
  "zenith_monolith",
  "ascension_six",
  "descent_six",
  "alpha_exact",
  "glyph_exact",
  "gemini_exact",
  "oracle_exact",
  "cosmic_exact",
  "mythic_exact",
  "number_spark",
  "numeric_run",
  "zero_signal",
  "sixty_seven_surge",
  "serial_digits",
  "digit_sum_seven",
  "digit_mirror",
  "mixed_master",
  "digit_duo",
  "digit_rainbow",
  "all_even",
  "all_odd",
  "digital_palindrome",
  "checksum_ten",
  "checksum_13",
  "checksum_20",
  "checksum_21",
  "checksum_42",
  "checksum_36",
  "checksum_45",
  "pi_spark",
  "fibonacci_ping",
  "square_signal",
  "digit_twins",
  "liftoff",
  "soft_landing",
  "odd_signal",
  "even_signal",
  "double_six",
  "reverse_67",
  "chrono_30",
  "area_51",
  "forty_two_gate",
  "error_404",
  "prime_chain_2357",
  "golden_ratio",
  "six_digit_palindrome",
  "same_digit_six",
  "ascending_digit_relic",
  "descending_digit_relic",
  "binary_alternator",
  "pi_relic",
  "euler_relic",
  "void_000000",
  "heaven_777777",
  "fives_555555",
]);

const ECONOMY_ODDS_SAMPLES = {
  letters: 900,
  numbers: 900,
};

const economyChanceCache = new Map();

const LOCAL_WORDS = `
ACE ACT ADD AGE AID AIM AIR ALE ALL ANT APE ARC ARE ARM ART ASH ASK ATE
BAD BAG BAN BAR BAT BAY BED BEE BET BID BIG BIN BIT BOB BOG BOX BOY BUD BUG BUS BUY
CAB CAD CAN CAP CAR CAT COD COG CON COP COT COW CRY CUB CUP CUT
DAD DAY DEN DEW DID DIE DIG DIM DOG DOT DRY DUE DUG
EAR EAT EEL EGG ELF END ERA EVE EYE FAN FAR FAT FED FEE FEN FEW FIG FIN FIT FIX FLY FOG FOX FUN FUR
GAP GAS GEM GET GIG GIN GOD GOT GUM GUN GUT GUY HAD HAM HAT HAY HEN HER HID HIM HIP HIT HOP HOT HOW HUG HUM HUT
ICE ION IVY JAM JAR JAW JET JIG JOB JOG JOY JUG KEY KID KIN KIT
LAB LAD LAG LAP LAW LAY LED LEG LET LID LIE LOG LOT LOW MAD MAN MAP MAT MAY MEN MET MID MIX MOB MOM MOP MUD
NAP NET NEW NIB NOD NOR NOT NOW NUT OAK OAR ODD OFF OIL OLD ONE ORB ORE OWL OWN
PAD PAL PAN PAT PAY PEA PEN PET PIE PIG PIN PIT POD POP POT PRO PUP PUT
RAG RAM RAN RAP RAT RAY RED RIB RID RIG RIP ROB ROD ROT ROW RUB RUN RYE
SAD SAG SAP SAT SAW SAY SEA SEE SET SHY SIN SIP SIT SKY SLY SOD SON SOW SOY SUN
TAB TAG TAN TAP TAR TAX TEA TEN THE TIE TIN TIP TOE TON TOP TOY TRY TUB TUG TWO
USE VAN VAT VET VOW WAR WAS WAY WEB WED WET WHO WHY WIN WIT WON WOW YAK YAM YAP YAW YES YET YOU ZAP ZIP ZOO
ABLE ACID ACRE AGED APEX AREA ARIA ATOM AURA BABY BACK BAKE BALD BALL BAND BARK BEAD BEAM BEAR BEAT BELL BEND BIRD BITE BLUE BOAT BOLD BOLT BOND BONE BOOK BOOM BORN BRAG BRIM BURN
CAFE CAKE CALM CAMP CARD CARE CART CASE CASH CAST CAVE CHAT CHIP COLD CORE COVE CROW CUBE CURE
DARE DARK DATA DAWN DICE DIVE DOME DOOR DOVE DRIP DROP DUAL DUNE DUSK EARN EASE EAST ECHO EDGE EVEN EVER
FACE FACT FADE FAIR FALL FARM FAST FATE FERN FIRE FISH FIVE FLAG FLIP FLOW FOLD FONT FOOD FORK FORM FOUR FROG
GAIN GAME GATE GEAR GIFT GLOW GOAL GOLD GOOD GRID GROW HALF HALL HAND HARD HARM HAZE HEAL HEAR HEAT HERO HILL HINT HIVE HOLD HOME HOPE HORN HUSH
IDEA IDLE IRON ITEM JADE JAZZ JUMP JUNE KIND KING KITE KNEW KNOW
LACE LADY LAKE LAMB LAMP LAND LANE LARK LATE LEAF LEAP LEFT LEND LENS LIFE LIFT LIME LINE LINK LION LIST LIVE LOAD LOAF LOCK LOOP LOVE LUCK LUNA
MADE MAGE MAIL MAIN MAKE MANY MARK MARS MATH MAZE MEAL MEAN MINT MIST MODE MOON MORE MOVE
NAME NEAR NEAT NERD NEST NICE NINE NODE NOON NOTE NOVA OATH OCEAN ODDS OPEN ORCA OVAL
PACE PACK PAGE PAIR PARK PART PATH PEAK PEAR PILE PINE PING PLAN PLAY PLOT PLUS POEM POND PORT PURE
RACE RAIN RANK RARE READ REAL REEF RIFT RING RISK ROAD ROCK ROLL ROPE ROSE RUNE RUSH
SAGE SAND SAVE SCAN SEAL SEED SEEK SHIP SIGN SING SINK SITE SNAP SNOW SOAR SOFT SOLO SONG SOUL SPAN STAR STEM STEP STIR STONE
TAIL TAKE TALK TALL TEAM TIDE TILE TIME TINY TONE TREE TRIO TRUE TUNE TURN UNIT USER
VALE VAST VIBE VINE VOID VOLT WAKE WALK WALL WAND WARM WAVE WILD WIND WING WIRE WISH WORD WORN YEAR YELL YOGA ZONE
ABOUT ABOVE ACTOR ACUTE ADAPT AFTER AGILE ALARM ALBUM ALERT ALIVE ALPHA AMBER AMONG ANGLE APPLE APPLY ARBOR ARENA ARISE AROMA ARROW
BADGE BASIC BEACH BEACON BEARD BEAST BEGIN BERRY BIRTH BLACK BLADE BLEND BLOCK BLOOM BONUS BRAIN BRAVE BRICK BRING BROAD BROWN BURST
CABLE CANDY CANON CATCH CHAIN CHARM CHECK CHEST CHIME CLOUD COAST CODEX COLOR COMBO COUNT CRAFT CRANE CRISP CROWN CURVE
DAILY DELTA DEPTH DIGIT DODGE DRAFT DREAM DRIFT DRIVE EAGLE EARTH ELITE EMPTY ENJOY ENTER EPOCH EQUAL EVENT EXTRA
FAITH FANCY FIELD FINAL FLAME FLASH FOCUS FORGE FOUND FRAME FRESH FROST FRUIT
GIANT GLIDE GLINT GLORY GLYPH GRACE GRADE GRAND GRANT GREEN GROUP GUARD GUESS
HEART HONEY HONOR HORSE HOUSE HUMAN HYPER IMAGE INDEX INPUT IVORY JELLY JOINT JUDGE JUICE
KARMA KNIFE KNOCK LASER LATCH LAYER LEARN LEVEL LIGHT LIMIT LOCAL LOGIC LUCKY LUNAR
MAGIC MATCH MAYBE METAL MIGHT MINOR MIXED MODEL MONEY MOTOR MOUNT MUSIC MYTHIC
NERVE NEVER NIGHT NOBLE NORTH NOVEL OASIS OCEAN OFFER OMEGA ORBIT ORDER OTHER
PANEL PARTY PATIO PEACE PEARL PIXEL PLAIN PLANE PLANT POINT POWER PRIME PRISM PROUD PULSE
QUICK QUIET QUOTA RADIO RANGE REACH READY REALM REACT REIGN RIVER ROBOT ROYAL
SCALE SCORE SCOUT SEEDY SEVEN SHADE SHARE SHARP SHIFT SHINE SIGHT SIGNAL SKILL SMART SNAKE SOLAR SOUND SPARK SPELL SPIRE STACK STAGE STORM STYLE SUGAR
TABLE TANGO TASTE THREE TIGER TIMER TOAST TOKEN TRACE TRACK TRAIL TRAIN TREND TRICK TRUTH
ULTRA UNION UPGRADE VALUE VAULT VECTOR VIDEO VITAL VIVID WATER WHEEL WHITE WINGS WITCH WORLD WORTH YOUNG ZEBRA ZESTY
ALPHAS ANCHOR ANIMAL ARCANE BADGES BANNER BEACON BINARY BOTTLE BRANCH BRIGHT BUTTON CANDLE CASTLE CHARGE CIRCLE CODING COSMIC CRYSTAL DRAGON ENERGY ENTROPY FACTOR FILTER FLOWER FUTURE GALAXY GLITCH GOLDEN HAMMER HUNTER ISLAND JUNGLE KNIGHT LETTER LIGHTS LITTLE MATRIX MEMORY MIRROR MYSTIC NUMBER ORACLE ORANGE PALACE PATTERN PHRASE PLANET PLAYER POCKET RANDOM REWARD RHYTHM ROCKET ROLLER SCANNER SECRET SHADOW SIGNAL SILVER SIMPLE SPHERE SPIRIT SPRING STREAM STRIKE SUMMER SWITCH SYMBOL SYSTEM TEMPLE THEORY THRIVE THUNDER TICKET TIMBER VECTOR VIOLET WINNER WIZARD WONDER
ABILITY ADVANCE AMAZING ANCIENT BALANCE BETWEEN BOOSTER CHANNEL CONTROL DIGITAL DISCOVER ELEMENT EMERALD FORTUNE FORWARD FREEDOM GENUINE GLYPHIC HARMONY IMAGINE JOURNEY KEYNOTE LEGEND LEXICON MACHINE MYSTERY NATURAL NETWORK ORBITAL PERFECT PHOENIX PRIVATE PROCESS PROJECT QUANTUM RAINBOW ROLLING SEQUENCE SPECIAL STRANGE SUNRISE VICTORY WEATHER
`;

const WORD_SET = new Set(
  LOCAL_WORDS.split(/\s+/)
    .map((word) => word.trim().toUpperCase())
    .filter((word) => /^[A-Z]{4,9}$/.test(word))
);

const BADGES = [
  { id: "double_trouble", name: "Double Trouble", description: "At least 2 matching characters appear in the sequence.", rarity: "common", value: 20, icon: "2", condition: (ctx) => ctx.maxCount >= 2 },
  { id: "triple_threat", name: "Triple Threat", description: "Three matching characters appear in one roll.", rarity: "uncommon", value: 60, icon: "3", condition: (ctx) => ctx.maxCount >= 3 },
  { id: "quad_core", name: "Quad Core", description: "Four matching characters land together.", rarity: "rare", value: 160, icon: "4", condition: (ctx) => ctx.maxCount >= 4 },
  { id: "alphabet_king", name: "Alphabet King", description: "Every character in the sequence is the same.", rarity: "mythic", value: 3000, icon: "A", condition: (ctx) => ctx.maxCount === ctx.sequence.length && ctx.sequence.length > 0 },
  { id: "vowel_storm", name: "Vowel Storm", description: "Four or more vowels appear in the roll.", rarity: "rare", value: 150, icon: "V", condition: (ctx) => ctx.vowelCount >= 4 },
  { id: "no_vowels", name: "No Vowels", description: "The sequence contains no vowels at all.", rarity: "uncommon", value: 55, icon: "Ø", condition: (ctx) => ctx.vowelCount === 0 },
  { id: "abc_run", name: "ABC Run", description: "The sequence contains ABC in order.", rarity: "epic", value: 500, icon: "ABC", condition: (ctx) => ctx.sequence.includes("ABC") },
  { id: "reverse_run", name: "Reverse Run", description: "The sequence contains ZYX or CBA.", rarity: "epic", value: 520, icon: "↺", condition: (ctx) => ctx.sequence.includes("ZYX") || ctx.sequence.includes("CBA") },
  { id: "palindrome", name: "Palindrome", description: "The sequence reads the same forwards and backwards.", rarity: "legendary", value: 1200, icon: "⇄", condition: (ctx) => ctx.sequence === reverseString(ctx.sequence) },
  { id: "keyboard_chaos", name: "Keyboard Chaos", description: "Every character is different.", rarity: "common", value: 25, icon: "⌨", condition: (ctx) => ctx.uniqueCount === ctx.sequence.length },
  { id: "lucky_seven", name: "Lucky Seven", description: "Alphabet-position total has a remainder of 7 when divided by 10.", rarity: "rare", value: 175, icon: "7", condition: (ctx) => ctx.alphaScore % 10 === 7 },
  { id: "high_alphabet", name: "High Alphabet", description: "Most letters are from N-Z.", rarity: "uncommon", value: 65, icon: "NZ", condition: (ctx) => ctx.letterCount > 0 && ctx.highCount >= Math.ceil(ctx.letterCount * 0.66) },
  { id: "low_alphabet", name: "Low Alphabet", description: "Most letters are from A-M.", rarity: "uncommon", value: 65, icon: "AM", condition: (ctx) => ctx.letterCount > 0 && ctx.lowCount >= Math.ceil(ctx.letterCount * 0.66) },
  { id: "snake_pattern", name: "Snake Pattern", description: "Letters alternate vowel, consonant, vowel, consonant, or the reverse.", rarity: "epic", value: 460, icon: "S", condition: (ctx) => ctx.letterCount === ctx.sequence.length && isAlternatingVowelConsonant(ctx.sequence) },
  { id: "glitched_roll", name: "Glitched Roll", description: "A very rare luck-touched bonus badge.", rarity: "glitched", value: 1800, icon: "⚡", condition: (ctx) => ctx.glitchedBonus },
  { id: "word_spark", name: "Word Spark", description: "Detect one 4+ letter dictionary or Gemini-confirmed word in your sequence.", rarity: "uncommon", value: 90, icon: "Aa", condition: (ctx) => ctx.words.length >= 1 },
  { id: "word_weaver", name: "Word Weaver", description: "Detect two or more 4+ letter words in one roll.", rarity: "rare", value: 260, icon: "W", condition: (ctx) => ctx.words.length >= 2 },
  { id: "full_word", name: "Perfectly Said", description: "The full sequence is a recognized word.", rarity: "legendary", value: 1500, icon: "✎", condition: (ctx) => ctx.fullSequenceWord },
  { id: "edge_case", name: "Edge Case", description: "Your roll includes both A and Z.", rarity: "rare", value: 210, icon: "AZ", condition: (ctx) => ctx.sequence.includes("A") && ctx.sequence.includes("Z") },
  { id: "pair_parade", name: "Pair Parade", description: "Three separate pairs appear in one sequence.", rarity: "epic", value: 620, icon: "++", condition: (ctx) => ctx.pairCount >= 3 },
  { id: "ladder_up", name: "Ladder Up", description: "Contains any ascending 3-letter alphabet run, like BCD.", rarity: "rare", value: 240, icon: "↗", condition: (ctx) => hasAlphabetRun(ctx.sequence, 3, 1) },
  { id: "ladder_down", name: "Ladder Down", description: "Contains any descending 3-letter alphabet run, like RQP.", rarity: "rare", value: 240, icon: "↘", condition: (ctx) => hasAlphabetRun(ctx.sequence, 3, -1) },
  { id: "lexicon_burst", name: "Lexicon Burst", description: "Find three or more 4+ letter words in one roll.", rarity: "epic", value: 700, icon: "LB", condition: (ctx) => ctx.words.length >= 3 },
  { id: "mirror_pair", name: "Mirror Pair", description: "The first and last characters match.", rarity: "uncommon", value: 70, icon: "◇", condition: (ctx) => ctx.sequence[0] === ctx.sequence[ctx.sequence.length - 1] },
  { id: "mixed_signal", name: "Digit Sync", description: "The digit lane is active beside the alphabet lane.", rarity: "rare", value: 260, numberMultiplier: 0.03, icon: "N#", requiresMixed: true, condition: (ctx) => ctx.isNumberRoll },
  { id: "number_spark", name: "Number Spark", description: "The digit lane contains three or more digits.", rarity: "uncommon", value: 95, numberMultiplier: 0.06, icon: "123", requiresMixed: true, condition: (ctx) => ctx.numberCount >= 3 },
  { id: "numeric_run", name: "Numeric Run", description: "The digit lane contains 123, 456, or 789.", rarity: "epic", value: 680, numberMultiplier: 0.1, icon: "#", requiresMixed: true, condition: (ctx) => /123|456|789/.test(ctx.sequence) },
  { id: "zero_signal", name: "Zero Signal", description: "The digit lane catches the zero signal.", rarity: "common", value: 35, numberMultiplier: 0.05, icon: "0", requiresMixed: true, condition: (ctx) => ctx.sequence.includes("0") },
  { id: "sixty_seven_surge", name: "Sixty-Seven Surge", description: "The digit lane contains 67. Adds a strong same-roll multiplier to alphabet badge Glyphs.", rarity: "rare", value: 0, numberMultiplier: 0.5, icon: "67", rollMode: "numbers", condition: (ctx) => ctx.sequence.includes("67") },
  { id: "luck_surge", name: "Luck Surge", description: "A random bonus badge that becomes more likely with Luck.", rarity: "rare", value: 300, icon: "✦", condition: (ctx) => ctx.luckSurge },
];

BADGES.push(
  { id: "exact_pair", name: "Exact Pair", description: "Exactly one pair appears, with no triples or higher.", rarity: "common", value: 35, icon: "2x", requiresUpgrade: "pattern_engine", condition: (ctx) => ctx.exactPairCount === 1 && ctx.maxCount === 2 },
  { id: "two_pair_tango", name: "Two-Pair Tango", description: "Two different characters each appear at least twice.", rarity: "uncommon", value: 95, icon: "22", requiresUpgrade: "pattern_engine", condition: (ctx) => ctx.pairCount >= 2 },
  { id: "full_house", name: "Full House", description: "A triple and a separate pair land together.", rarity: "epic", value: 760, icon: "FH", requiresUpgrade: "pattern_engine", condition: (ctx) => ctx.hasTriple && ctx.hasPair },
  { id: "fivefold_signal", name: "Fivefold Signal", description: "Five matching characters appear in one roll.", rarity: "legendary", value: 1450, icon: "5", requiresUpgrade: "pattern_engine", condition: (ctx) => ctx.maxCount >= 5 },
  { id: "double_tap", name: "Double Tap", description: "Two identical characters sit next to each other.", rarity: "common", value: 45, icon: "||", requiresUpgrade: "pattern_engine", condition: (ctx) => ctx.hasAdjacentRepeat },
  { id: "triple_stack", name: "Triple Stack", description: "Three identical characters appear consecutively.", rarity: "rare", value: 310, icon: "|||", requiresUpgrade: "pattern_engine", condition: (ctx) => ctx.hasAdjacentTriple },
  { id: "sandwich_code", name: "Sandwich Code", description: "A character repeats with one character between it, like ABA.", rarity: "uncommon", value: 110, icon: "ABA", requiresUpgrade: "pattern_engine", condition: (ctx) => ctx.hasSandwich },
  { id: "bookends", name: "Bookends", description: "The first and last tiles match.", rarity: "uncommon", value: 85, icon: "[]", requiresUpgrade: "mirror_array", condition: (ctx) => ctx.firstChar === ctx.lastChar },
  { id: "inner_mirror", name: "Inner Mirror", description: "The second and second-last tiles match.", rarity: "rare", value: 260, icon: "<>", requiresUpgrade: "mirror_array", condition: (ctx) => ctx.sequence.length >= 4 && ctx.sequence[1] === ctx.sequence[ctx.sequence.length - 2] },
  { id: "half_mirror", name: "Half Mirror", description: "At least two mirrored tile pairs match.", rarity: "epic", value: 680, icon: "HM", requiresUpgrade: "mirror_array", condition: (ctx) => ctx.symmetryPairs >= 2 },
  { id: "rare_letter", name: "Rare Letter", description: "The sequence includes Q, X, Z, or J.", rarity: "common", value: 50, icon: "QZ", requiresUpgrade: "rare_letter_radar", condition: (ctx) => ctx.rareLetterCount >= 1 },
  { id: "rare_cluster", name: "Rare Cluster", description: "Two or more rare letters appear.", rarity: "rare", value: 340, icon: "RX", requiresUpgrade: "rare_letter_radar", condition: (ctx) => ctx.rareLetterCount >= 2 },
  { id: "q_without_u", name: "Q Without U", description: "Q appears without U.", rarity: "epic", value: 620, icon: "Q!", requiresUpgrade: "rare_letter_radar", condition: (ctx) => ctx.sequence.includes("Q") && !ctx.sequence.includes("U") },
  { id: "x_marks", name: "X Marks", description: "X appears in the roll.", rarity: "common", value: 45, icon: "X", requiresUpgrade: "rare_letter_radar", condition: (ctx) => ctx.sequence.includes("X") },
  { id: "zed_zone", name: "Zed Zone", description: "Z appears in the roll.", rarity: "common", value: 45, icon: "Z", requiresUpgrade: "rare_letter_radar", condition: (ctx) => ctx.sequence.includes("Z") },
  { id: "alpha_omega", name: "Alpha Omega", description: "The roll starts with A and ends with Z, or the reverse.", rarity: "legendary", value: 1600, icon: "AZ", requiresUpgrade: "alphabet_radar", condition: (ctx) => (ctx.firstChar === "A" && ctx.lastChar === "Z") || (ctx.firstChar === "Z" && ctx.lastChar === "A") },
  { id: "alphabet_span", name: "Alphabet Span", description: "Letters span at least 20 alphabet positions.", rarity: "rare", value: 260, icon: "A-Z", requiresUpgrade: "alphabet_radar", condition: (ctx) => ctx.alphabetSpan >= 20 },
  { id: "balanced_scale", name: "Balanced Scale", description: "A-M and N-Z appear in equal amounts.", rarity: "uncommon", value: 120, icon: "==", requiresUpgrade: "alphabet_radar", condition: (ctx) => ctx.letterCount > 1 && ctx.highCount === ctx.lowCount },
  { id: "prime_signal", name: "Prime Signal", description: "Alphabet-position total is a prime number.", rarity: "rare", value: 330, icon: "P", requiresUpgrade: "alphabet_radar", condition: (ctx) => isPrime(ctx.alphaScore) },
  { id: "perfect_hundred", name: "Perfect Hundred", description: "Alphabet-position total equals exactly 100.", rarity: "legendary", value: 1700, icon: "100", requiresUpgrade: "alphabet_radar", condition: (ctx) => ctx.alphaScore === 100 },
  { id: "zigzag_signal", name: "Zigzag Signal", description: "Alphabet values alternate up and down across the roll.", rarity: "epic", value: 720, icon: "ZZ", requiresUpgrade: "alphabet_radar", condition: (ctx) => ctx.zigzagAlphabet },
  { id: "high_low_switch", name: "High-Low Switch", description: "Letters alternate between A-M and N-Z.", rarity: "epic", value: 650, icon: "HL", requiresUpgrade: "alphabet_radar", condition: (ctx) => ctx.highLowAlternating },
  { id: "vowel_crown", name: "Vowel Crown", description: "Every letter in the roll is a vowel.", rarity: "legendary", value: 1550, icon: "AE", requiresUpgrade: "pattern_engine", condition: (ctx) => ctx.letterCount > 0 && ctx.letterCount === ctx.sequence.length && ctx.vowelCount === ctx.letterCount },
  { id: "consonant_wall", name: "Consonant Wall", description: "At least five consonants appear.", rarity: "rare", value: 300, icon: "CW", requiresUpgrade: "pattern_engine", condition: (ctx) => ctx.consonantCount >= 5 },
  { id: "vowel_run", name: "Vowel Run", description: "Three vowels appear consecutively.", rarity: "rare", value: 360, icon: "VVV", requiresUpgrade: "pattern_engine", condition: (ctx) => ctx.hasVowelRun },
  { id: "consonant_run", name: "Consonant Run", description: "Four consonants appear consecutively.", rarity: "uncommon", value: 130, icon: "CCCC", requiresUpgrade: "pattern_engine", condition: (ctx) => ctx.hasConsonantRun },
  { id: "four_letter_word", name: "Four-Letter Find", description: "Find a word of length 4 or more.", rarity: "uncommon", value: 120, icon: "4W", requiresUpgrade: "word_lens", condition: (ctx) => ctx.longestWordLength >= 4 },
  { id: "five_letter_word", name: "Five-Letter Find", description: "Find a word of length 5 or more.", rarity: "rare", value: 380, icon: "5W", requiresUpgrade: "word_lens", condition: (ctx) => ctx.longestWordLength >= 5 },
  { id: "six_letter_word", name: "Six-Letter Find", description: "Find a word of length 6 or more.", rarity: "legendary", value: 1500, icon: "6W", requiresUpgrade: "phrase_matrix", condition: (ctx) => ctx.longestWordLength >= 6 },
  { id: "word_cover", name: "Word Cover", description: "A detected word covers at least 70% of the sequence.", rarity: "epic", value: 760, icon: "WC", requiresUpgrade: "phrase_matrix", condition: (ctx) => ctx.wordCoverage >= 0.7 },
  { id: "digit_pair", name: "Digit Pair", description: "Two matching digits appear in the digit lane.", rarity: "uncommon", value: 110, numberMultiplier: 0.06, icon: "##", requiresMixed: true, requiresUpgrade: "number_attunement", condition: (ctx) => ctx.numberPairCount >= 1 },
  { id: "serial_digits", name: "Serial Digits", description: "The digit lane produces three or more digits.", rarity: "rare", value: 300, numberMultiplier: 0.08, icon: "S#", requiresMixed: true, requiresUpgrade: "number_attunement", condition: (ctx) => ctx.numberCount >= 3 },
  { id: "binary_pulse", name: "Binary Pulse", description: "The roll contains both 0 and 1.", rarity: "rare", value: 280, numberMultiplier: 0.08, icon: "01", requiresMixed: true, requiresUpgrade: "number_attunement", condition: (ctx) => ctx.numberCount >= 3 && ctx.sequence.includes("0") && ctx.sequence.includes("1") },
  { id: "digit_sum_seven", name: "Digit Sum Seven", description: "All digits in the roll add up to exactly 7.", rarity: "epic", value: 680, numberMultiplier: 0.1, icon: "7#", requiresMixed: true, requiresUpgrade: "digit_alchemy", condition: (ctx) => ctx.numberCount > 0 && ctx.digitSum === 7 },
  { id: "digit_mirror", name: "Digit Mirror", description: "The first and last characters are the same number.", rarity: "epic", value: 720, numberMultiplier: 0.1, icon: "#M", requiresMixed: true, requiresUpgrade: "digit_alchemy", condition: (ctx) => ctx.numberCount >= 3 && /\d/.test(ctx.firstChar) && ctx.firstChar === ctx.lastChar },
  { id: "mixed_master", name: "Digit Master", description: "The digit lane has at least five unique digits.", rarity: "epic", value: 820, numberMultiplier: 0.12, icon: "D+", requiresMixed: true, requiresUpgrade: "mixed_mastery", condition: (ctx) => ctx.isNumberRoll && ctx.digitUniqueCount >= 5 },
  { id: "mythic_pulse", name: "Mythic Pulse", description: "A tiny endgame resonance bonus triggers.", rarity: "mythic", value: 2200, icon: "MP", requiresUpgrade: "mythic_lens", condition: (ctx) => ctx.mythicPulse },
  { id: "omega_archive", name: "Omega Archive", description: "A massive max-lane roll hits rare letters and long words.", rarity: "mythic", value: 2600, icon: "OA", requiresUpgrade: "alpha_omega_core", condition: (ctx) => ctx.sequence.length === 6 && ctx.longestWordLength >= 5 && ctx.rareLetterCount >= 1 }
);

BADGES.push(
  { id: "front_loaded", name: "Front Loaded", description: "The roll starts with A, B, or C.", rarity: "common", value: 40, icon: "ABC", rollMode: "letters", condition: (ctx) => ["A", "B", "C"].includes(ctx.firstChar) },
  { id: "z_finish", name: "Z Finish", description: "The roll ends with X, Y, or Z.", rarity: "common", value: 45, icon: "XYZ", rollMode: "letters", condition: (ctx) => ["X", "Y", "Z"].includes(ctx.lastChar) },
  { id: "royal_pair", name: "Royal Pair", description: "K and Q both appear in the same letter roll.", rarity: "rare", value: 330, icon: "KQ", rollMode: "letters", condition: (ctx) => ctx.sequence.includes("K") && ctx.sequence.includes("Q") },
  { id: "vowel_balance", name: "Vowel Balance", description: "Exactly half of the letters are vowels.", rarity: "rare", value: 320, icon: "50", rollMode: "letters", condition: (ctx) => ctx.letterCount > 0 && ctx.vowelCount * 2 === ctx.letterCount },
  { id: "center_vowel", name: "Center Vowel", description: "A vowel lands in the center of the roll.", rarity: "uncommon", value: 115, icon: "CV", rollMode: "letters", condition: (ctx) => { const mid = Math.floor(ctx.sequence.length / 2); return VOWELS.has(ctx.sequence[mid]) || (ctx.sequence.length % 2 === 0 && VOWELS.has(ctx.sequence[mid - 1])); } },
  { id: "letter_spectrum", name: "Letter Spectrum", description: "The roll includes a low, middle, and high alphabet letter.", rarity: "epic", value: 640, icon: "LMH", rollMode: "letters", condition: (ctx) => { const positions = ctx.letters.map(getAlphabetPosition); return positions.some((value) => value <= 8) && positions.some((value) => value >= 9 && value <= 18) && positions.some((value) => value >= 19); } },
  { id: "alpha_sum_50", name: "Alpha Sum 50", description: "Alphabet-position total equals exactly 50.", rarity: "rare", value: 390, icon: "Σ50", rollMode: "letters", condition: (ctx) => ctx.alphaScore === 50 },
  { id: "alpha_sum_111", name: "Alpha Sum 111", description: "Alphabet-position total equals exactly 111.", rarity: "legendary", value: 1750, icon: "111", rollMode: "letters", condition: (ctx) => ctx.alphaScore === 111 },
  { id: "gemini_word", name: "Gemini Word", description: "Gemini confirms at least one word in the sequence.", rarity: "rare", value: 420, icon: "AI", rollMode: "letters", condition: (ctx) => ctx.words.some((word) => word.source === "gemini") },
  { id: "long_word_hero", name: "Six-Word Hero", description: "Find a six-letter word at the max alphabet lane.", rarity: "mythic", value: 2800, icon: "6W+", rollMode: "letters", condition: (ctx) => ctx.sequence.length === 6 && ctx.longestWordLength >= 6 },
  { id: "digit_duo", name: "Digit Duo", description: "Exactly two different digits appear.", rarity: "common", value: 80, numberMultiplier: 0.05, icon: "D2", rollMode: "numbers", condition: (ctx) => ctx.isNumberRoll && ctx.digitUniqueCount === 2 },
  { id: "digit_rainbow", name: "Digit Rainbow", description: "At least six unique digits appear.", rarity: "epic", value: 760, numberMultiplier: 0.14, icon: "D6", rollMode: "numbers", condition: (ctx) => ctx.isNumberRoll && ctx.digitUniqueCount >= 6 },
  { id: "all_even", name: "Even Engine", description: "Every digit is even.", rarity: "rare", value: 360, numberMultiplier: 0.08, icon: "EV", rollMode: "numbers", condition: (ctx) => ctx.numberCount >= 3 && ctx.allEvenDigits },
  { id: "all_odd", name: "Odd Engine", description: "Every digit is odd.", rarity: "rare", value: 360, numberMultiplier: 0.08, icon: "OD", rollMode: "numbers", condition: (ctx) => ctx.numberCount >= 3 && ctx.allOddDigits },
  { id: "even_odd_balance", name: "Even-Odd Balance", description: "Even and odd digits appear in equal amounts.", rarity: "uncommon", value: 150, numberMultiplier: 0.05, icon: "EO", rollMode: "numbers", condition: (ctx) => ctx.isNumberRoll && ctx.numberCount >= 4 && ctx.evenDigitCount === ctx.oddDigitCount },
  { id: "prime_party", name: "Prime Party", description: "At least four digits are 2, 3, 5, or 7.", rarity: "epic", value: 720, numberMultiplier: 0.12, icon: "PR", rollMode: "numbers", condition: (ctx) => ctx.primeDigitCount >= 4 },
  { id: "zero_duo", name: "Zero Duo", description: "Two or more zeroes appear.", rarity: "uncommon", value: 160, numberMultiplier: 0.06, icon: "00", rollMode: "numbers", condition: (ctx) => ctx.zeroCount >= 2 },
  { id: "void_stack", name: "Void Stack", description: "Three zeroes appear.", rarity: "legendary", value: 1500, numberMultiplier: 0.2, icon: "000", rollMode: "numbers", condition: (ctx) => ctx.zeroCount >= 3 },
  { id: "triple_seven", name: "Triple Seven", description: "Three or more 7s appear.", rarity: "legendary", value: 1700, numberMultiplier: 0.22, icon: "777", rollMode: "numbers", condition: (ctx) => (ctx.numberCounts["7"] || 0) >= 3 },
  { id: "ascending_digits", name: "Ascending Digits", description: "Three digits climb in order, like 345.", rarity: "rare", value: 380, numberMultiplier: 0.08, icon: "↗#", rollMode: "numbers", condition: (ctx) => ctx.digitAscendingRun },
  { id: "descending_digits", name: "Descending Digits", description: "Three digits descend in order, like 654.", rarity: "rare", value: 380, numberMultiplier: 0.08, icon: "↘#", rollMode: "numbers", condition: (ctx) => ctx.digitDescendingRun },
  { id: "digit_straight_four", name: "Four-Step Straight", description: "Four digits ascend or descend in a row.", rarity: "epic", value: 880, numberMultiplier: 0.15, icon: "4#", rollMode: "numbers", condition: (ctx) => ctx.digitStraightFour },
  { id: "digital_palindrome", name: "Digital Palindrome", description: "The digit lane reads the same forward and backward.", rarity: "legendary", value: 1800, numberMultiplier: 0.22, icon: "#↔", rollMode: "numbers", condition: (ctx) => ctx.isNumberRoll && ctx.numberCount >= 4 && ctx.sequence === reverseString(ctx.sequence) },
  { id: "checksum_ten", name: "Checksum Ten", description: "Digit sum is divisible by 10.", rarity: "uncommon", value: 180, numberMultiplier: 0.06, icon: "Σ10", rollMode: "numbers", condition: (ctx) => ctx.isNumberRoll && ctx.digitSum > 0 && ctx.digitSum % 10 === 0 },
  { id: "checksum_21", name: "Checksum 21", description: "Digit sum equals exactly 21.", rarity: "rare", value: 440, numberMultiplier: 0.1, icon: "Σ21", rollMode: "numbers", condition: (ctx) => ctx.digitSum === 21 },
  { id: "checksum_42", name: "Checksum 42", description: "Digit sum equals exactly 42.", rarity: "legendary", value: 1900, numberMultiplier: 0.24, icon: "Σ42", rollMode: "numbers", condition: (ctx) => ctx.digitSum === 42 },
  { id: "pi_spark", name: "Pi Spark", description: "The sequence contains 314.", rarity: "epic", value: 820, numberMultiplier: 0.14, icon: "π", rollMode: "numbers", condition: (ctx) => ctx.sequence.includes("314") },
  { id: "fibonacci_ping", name: "Fibonacci Ping", description: "The sequence contains 1123, 2358, or 112358.", rarity: "mythic", value: 2600, numberMultiplier: 0.3, icon: "Fib", rollMode: "numbers", condition: (ctx) => /112358|1123|2358/.test(ctx.sequence) },
  { id: "square_signal", name: "Square Signal", description: "The roll contains a two-digit square like 16, 25, 36, 49, 64, or 81.", rarity: "rare", value: 410, numberMultiplier: 0.09, icon: "□", rollMode: "numbers", condition: (ctx) => /16|25|36|49|64|81/.test(ctx.sequence) },
  { id: "binary_roll", name: "Binary Roll", description: "The whole roll uses only 0s and 1s.", rarity: "epic", value: 900, numberMultiplier: 0.16, icon: "01", rollMode: "numbers", condition: (ctx) => ctx.isNumberRoll && ctx.numberCount >= 4 && /^[01]+$/.test(ctx.sequence) },
  { id: "high_digits", name: "High Digits", description: "Most digits are 5-9.", rarity: "uncommon", value: 145, numberMultiplier: 0.05, icon: "5+", rollMode: "numbers", condition: (ctx) => ctx.isNumberRoll && ctx.numberCount >= 3 && ctx.digitValues.filter((value) => value >= 5).length >= Math.ceil(ctx.numberCount * 0.66) },
  { id: "low_digits", name: "Low Digits", description: "Most digits are 0-4.", rarity: "uncommon", value: 145, numberMultiplier: 0.05, icon: "0-4", rollMode: "numbers", condition: (ctx) => ctx.isNumberRoll && ctx.numberCount >= 3 && ctx.digitValues.filter((value) => value <= 4).length >= Math.ceil(ctx.numberCount * 0.66) }
);

BADGES.push(
  { id: "vowel_bookends", name: "Vowel Bookends", description: "The first and last alphabet tiles are both vowels.", rarity: "rare", value: 340, icon: "AE", rollMode: "letters", condition: (ctx) => VOWELS.has(ctx.firstChar) && VOWELS.has(ctx.lastChar) },
  { id: "rare_trinity", name: "Rare Trinity", description: "Three or more Q, X, Z, or J letters appear.", rarity: "epic", value: 880, icon: "QZX", rollMode: "letters", condition: (ctx) => ctx.rareLetterCount >= 3 },
  { id: "alphabet_quad_up", name: "Quad Ladder Up", description: "Contains any ascending 4-letter alphabet run, like CDEF.", rarity: "epic", value: 920, icon: "ABCD", rollMode: "letters", condition: (ctx) => hasAlphabetRun(ctx.sequence, 4, 1) },
  { id: "alphabet_quad_down", name: "Quad Ladder Down", description: "Contains any descending 4-letter alphabet run, like ZYXW.", rarity: "epic", value: 940, icon: "ZYXW", rollMode: "letters", condition: (ctx) => hasAlphabetRun(ctx.sequence, 4, -1) },
  { id: "all_low_wall", name: "Low Wall", description: "Every alphabet tile is from A-M.", rarity: "epic", value: 720, icon: "LOW", rollMode: "letters", condition: (ctx) => ctx.letterCount > 0 && ctx.lowCount === ctx.letterCount },
  { id: "all_high_skyline", name: "High Skyline", description: "Every alphabet tile is from N-Z.", rarity: "epic", value: 740, icon: "HIGH", rollMode: "letters", condition: (ctx) => ctx.letterCount > 0 && ctx.highCount === ctx.letterCount },
  { id: "alpha_sum_77", name: "Alpha Sum 77", description: "Alphabet-position total equals exactly 77.", rarity: "epic", value: 850, icon: "Σ77", rollMode: "letters", condition: (ctx) => ctx.alphaScore === 77 },
  { id: "word_monarch", name: "Word Monarch", description: "Find a six-letter word that fills the max alphabet lane.", rarity: "mythic", value: 3600, icon: "6W", rollMode: "letters", condition: (ctx) => ctx.sequence.length === 6 && ctx.longestWordLength >= 6 },
  { id: "opening_word", name: "Opening Word", description: "A detected 4+ letter word starts at the first tile.", rarity: "rare", value: 430, icon: "▶W", rollMode: "letters", condition: (ctx) => ctx.words.some((word) => Number(word.start) === 0) },
  { id: "ending_word", name: "Closing Word", description: "A detected 4+ letter word ends on the final tile.", rarity: "rare", value: 430, icon: "W◀", rollMode: "letters", condition: (ctx) => ctx.words.some((word) => Number(word.start) + Number(word.length || word.word?.length || 0) === ctx.sequence.length) },
  { id: "mirror_gate", name: "Mirror Gate", description: "Three or more mirrored tile pairs match.", rarity: "legendary", value: 1900, icon: "M3", rollMode: "letters", condition: (ctx) => ctx.symmetryPairs >= 3 },
  { id: "perfect_balance", name: "Perfect Balance", description: "Vowels and consonants appear in equal amounts.", rarity: "rare", value: 360, icon: "VC", rollMode: "letters", condition: (ctx) => ctx.letterCount >= 4 && ctx.vowelCount === ctx.consonantCount },
  { id: "compact_core_4", name: "Compact Core", description: "Roll exactly 4 alphabet letters. A clean starter-lane signature.", rarity: "common", value: 45, icon: "4L", rollMode: "letters", condition: (ctx) => ctx.sequence.length === 4 },
  { id: "bridge_frame_5", name: "Bridge Frame", description: "Roll exactly 5 alphabet letters. The middle lane has its own rhythm.", rarity: "uncommon", value: 135, icon: "5L", rollMode: "letters", condition: (ctx) => ctx.sequence.length === 5 },
  { id: "sixfold_crown", name: "Sixfold Crown", description: "Roll exactly 6 alphabet letters. The max alphabet lane is active.", rarity: "rare", value: 360, icon: "6L", rollMode: "letters", condition: (ctx) => ctx.sequence.length === 6 },
  { id: "hydrogen", name: "Hydrogen", description: "The digit lane contains exactly one 1.", rarity: "common", value: 0, numberMultiplier: 0.05, icon: "H1", rollMode: "numbers", condition: (ctx) => (ctx.numberCounts["1"] || 0) === 1 },
  { id: "digit_lucky_seven", name: "Digit Lucky Seven", description: "The digit lane contains exactly one 7.", rarity: "common", value: 0, numberMultiplier: 0.05, icon: "7", rollMode: "numbers", condition: (ctx) => (ctx.numberCounts["7"] || 0) === 1 },
  { id: "liftoff", name: "Liftoff", description: "The first digit is larger than the last digit.", rarity: "common", value: 0, numberMultiplier: 0.04, icon: "🚀", rollMode: "numbers", condition: (ctx) => ctx.numberCount >= 2 && Number(ctx.firstChar) > Number(ctx.lastChar) },
  { id: "soft_landing", name: "Soft Landing", description: "The first digit is smaller than the last digit.", rarity: "common", value: 0, numberMultiplier: 0.04, icon: "↓", rollMode: "numbers", condition: (ctx) => ctx.numberCount >= 2 && Number(ctx.firstChar) < Number(ctx.lastChar) },
  { id: "odd_signal", name: "Odd Signal", description: "The digit sum is odd.", rarity: "common", value: 0, numberMultiplier: 0.03, icon: "OD", rollMode: "numbers", condition: (ctx) => ctx.numberCount > 0 && ctx.digitSum % 2 === 1 },
  { id: "even_signal", name: "Even Signal", description: "The digit sum is even.", rarity: "common", value: 0, numberMultiplier: 0.03, icon: "EV", rollMode: "numbers", condition: (ctx) => ctx.numberCount > 0 && ctx.digitSum % 2 === 0 },
  { id: "checksum_13", name: "Checksum 13", description: "Digit sum equals exactly 13.", rarity: "rare", value: 0, numberMultiplier: 0.08, icon: "Σ13", rollMode: "numbers", condition: (ctx) => ctx.digitSum === 13 },
  { id: "checksum_20", name: "Checksum 20", description: "Digit sum equals exactly 20.", rarity: "uncommon", value: 0, numberMultiplier: 0.06, icon: "Σ20", rollMode: "numbers", condition: (ctx) => ctx.digitSum === 20 },
  { id: "double_six", name: "Double Six", description: "The digit lane contains 66.", rarity: "rare", value: 0, numberMultiplier: 0.11, icon: "66", rollMode: "numbers", condition: (ctx) => ctx.sequence.includes("66") },
  { id: "reverse_67", name: "Reverse Surge", description: "The digit lane contains 76, the mirror of the 67 surge.", rarity: "epic", value: 0, numberMultiplier: 0.14, icon: "76", rollMode: "numbers", condition: (ctx) => ctx.sequence.includes("76") }
);

BADGES.push(
  { id: "starter_mirror_4", name: "Starter Mirror", description: "A 4-letter alphabet roll mirrors perfectly, like ABBA.", rarity: "rare", value: 620, icon: "4M", rollMode: "letters", condition: (ctx) => ctx.sequence.length === 4 && ctx.sequence === reverseString(ctx.sequence) },
  { id: "centerpiece_5", name: "Centerpiece Mirror", description: "A 5-letter alphabet roll forms a clean palindrome.", rarity: "legendary", value: 2100, icon: "5M", rollMode: "letters", condition: (ctx) => ctx.sequence.length === 5 && ctx.sequence === reverseString(ctx.sequence) },
  { id: "hex_mirror", name: "Hex Mirror", description: "A 6-letter alphabet roll mirrors perfectly from edge to edge.", rarity: "mythic", value: 7200, icon: "6M", rollMode: "letters", condition: (ctx) => ctx.sequence.length === 6 && ctx.sequence === reverseString(ctx.sequence) },
  { id: "quad_singularity", name: "Quad Singularity", description: "All 4 starter-lane alphabet tiles are the same letter.", rarity: "legendary", value: 3400, icon: "4X", rollMode: "letters", condition: (ctx) => ctx.sequence.length === 4 && ctx.maxCount === 4 },
  { id: "penta_singularity", name: "Penta Singularity", description: "All 5 alphabet tiles are the same letter.", rarity: "mythic", value: 12000, icon: "5X", rollMode: "letters", condition: (ctx) => ctx.sequence.length === 5 && ctx.maxCount === 5 },
  { id: "perfect_hex_singularity", name: "Perfect Hex Singularity", description: "All 6 alphabet tiles are the same letter. This is a chamber-breaking hit.", rarity: "glitched", value: 65000, icon: "6X", rollMode: "letters", condition: (ctx) => ctx.sequence.length === 6 && ctx.maxCount === 6 },
  { id: "aether_monolith", name: "Aether Monolith", description: "The alphabet lane rolls AAAAAA.", rarity: "glitched", value: 150000, icon: "AAAA", rollMode: "letters", condition: (ctx) => ctx.sequence === "AAAAAA" },
  { id: "zenith_monolith", name: "Zenith Monolith", description: "The alphabet lane rolls ZZZZZZ.", rarity: "glitched", value: 150000, icon: "ZZZZ", rollMode: "letters", condition: (ctx) => ctx.sequence === "ZZZZZZ" },
  { id: "ascension_six", name: "Ascension Six", description: "The alphabet lane rolls the exact ascending relic ABCDEF.", rarity: "glitched", value: 36000, icon: "A-F", rollMode: "letters", condition: (ctx) => ctx.sequence === "ABCDEF" },
  { id: "descent_six", name: "Descent Six", description: "The alphabet lane rolls the exact descending relic ZYXWVU.", rarity: "glitched", value: 36000, icon: "Z-U", rollMode: "letters", condition: (ctx) => ctx.sequence === "ZYXWVU" },
  { id: "void_alphabet", name: "Void Alphabet", description: "Every max-lane letter is one of Q, X, Z, or J.", rarity: "mythic", value: 14000, icon: "VOID", rollMode: "letters", condition: (ctx) => ctx.sequence.length === 6 && ctx.letters.every((char) => "QXZJ".includes(char)) },
  { id: "quartz_crown", name: "Quartz Crown", description: "Q, X, and Z all appear together with no vowels.", rarity: "mythic", value: 5600, icon: "QXZ", rollMode: "letters", condition: (ctx) => ctx.sequence.includes("Q") && ctx.sequence.includes("X") && ctx.sequence.includes("Z") && ctx.vowelCount === 0 },
  { id: "vowel_singularity_6", name: "Vowel Singularity", description: "All 6 alphabet tiles are vowels.", rarity: "mythic", value: 6800, icon: "V6", rollMode: "letters", condition: (ctx) => ctx.sequence.length === 6 && ctx.vowelCount === 6 },
  { id: "prime_letter_crown", name: "Prime Letter Crown", description: "Every alphabet tile lands on a prime alphabet position.", rarity: "legendary", value: 3200, icon: "P6", rollMode: "letters", condition: (ctx) => ctx.sequence.length === 6 && ctx.letters.every((char) => [2, 3, 5, 7, 11, 13, 17, 19, 23].includes(getAlphabetPosition(char))) },
  { id: "fibonacci_crown", name: "Fibonacci Crown", description: "Every alphabet tile lands on a Fibonacci alphabet position.", rarity: "mythic", value: 9000, icon: "FIB", rollMode: "letters", condition: (ctx) => ctx.sequence.length === 6 && ctx.letters.every((char) => [1, 2, 3, 5, 8, 13, 21].includes(getAlphabetPosition(char))) },
  { id: "golden_sigma", name: "Golden Sigma", description: "The alphabet-position total equals exactly 137.", rarity: "legendary", value: 2600, icon: "S137", rollMode: "letters", condition: (ctx) => ctx.alphaScore === 137 },
  { id: "perfect_sigma", name: "Perfect Sigma", description: "The alphabet-position total equals exactly 123.", rarity: "legendary", value: 2400, icon: "S123", rollMode: "letters", condition: (ctx) => ctx.alphaScore === 123 },
  { id: "alpha_exact", name: "Alpha Relic", description: "The alphabet lane rolls the exact word ALPHA.", rarity: "mythic", value: 14000, icon: "AL", rollMode: "letters", condition: (ctx) => ctx.sequence === "ALPHA" },
  { id: "glyph_exact", name: "Glyph Relic", description: "The alphabet lane rolls the exact word GLYPH.", rarity: "mythic", value: 16000, icon: "GL", rollMode: "letters", condition: (ctx) => ctx.sequence === "GLYPH" },
  { id: "gemini_exact", name: "Gemini Relic", description: "The alphabet lane rolls GEMINI exactly.", rarity: "glitched", value: 42000, icon: "AI6", rollMode: "letters", condition: (ctx) => ctx.sequence === "GEMINI" },
  { id: "oracle_exact", name: "Oracle Relic", description: "The alphabet lane rolls ORACLE exactly.", rarity: "glitched", value: 38000, icon: "OR6", rollMode: "letters", condition: (ctx) => ctx.sequence === "ORACLE" },
  { id: "cosmic_exact", name: "Cosmic Relic", description: "The alphabet lane rolls COSMIC exactly.", rarity: "glitched", value: 38000, icon: "CO6", rollMode: "letters", condition: (ctx) => ctx.sequence === "COSMIC" },
  { id: "mythic_exact", name: "Mythic Relic", description: "The alphabet lane rolls MYTHIC exactly.", rarity: "glitched", value: 40000, icon: "MY6", rollMode: "letters", condition: (ctx) => ctx.sequence === "MYTHIC" },
  { id: "full_word_oracle", name: "Full Word Oracle", description: "A full 6-letter sequence is recognized as a complete word.", rarity: "mythic", value: 8200, icon: "W6", rollMode: "letters", condition: (ctx) => ctx.sequence.length === 6 && ctx.fullSequenceWord },
  { id: "gemini_oracle_word", name: "Gemini Oracle Word", description: "Gemini confirms a word that fills the entire 6-letter alphabet lane.", rarity: "glitched", value: 18000, icon: "AIW", rollMode: "letters", condition: (ctx) => ctx.sequence.length === 6 && ctx.words.some((word) => word.source === "gemini" && Number(word.start) === 0 && Number(word.length || word.word?.length || 0) === 6) },
  { id: "cosmic_jackpot", name: "Cosmic Jackpot", description: "A tiny luck-touched pulse erupts after the alphabet roll.", rarity: "mythic", value: 10000, icon: "CJ", rollMode: "letters", condition: (ctx) => ctx.cosmicPulse },
  { id: "reality_rift", name: "Reality Rift", description: "A nearly impossible rift tears open behind the alphabet tiles.", rarity: "glitched", value: 45000, icon: "RIFT", rollMode: "letters", condition: (ctx) => ctx.realityRift },
  { id: "abyssal_jackpot", name: "Abyssal Jackpot", description: "The chamber briefly breaks reality. Absurdly rare. Absurdly valuable.", rarity: "glitched", value: 120000, icon: "ABY", rollMode: "letters", condition: (ctx) => ctx.abyssalJackpot },
  { id: "digit_twins", name: "Digit Twins", description: "The number lane starts small but lands two matching digits.", rarity: "uncommon", value: 0, numberMultiplier: 0.07, icon: "##", rollMode: "numbers", condition: (ctx) => ctx.numberCount === 2 && ctx.maxCount === 2 },
  { id: "chrono_30", name: "Chrono Thirty", description: "The number lane contains 30.", rarity: "common", value: 0, numberMultiplier: 0.05, icon: "30", rollMode: "numbers", condition: (ctx) => ctx.sequence.includes("30") },
  { id: "area_51", name: "Area 51", description: "The number lane contains 51.", rarity: "common", value: 0, numberMultiplier: 0.06, icon: "51", rollMode: "numbers", condition: (ctx) => ctx.sequence.includes("51") },
  { id: "forty_two_gate", name: "Forty-Two Gate", description: "The number lane contains 42.", rarity: "uncommon", value: 0, numberMultiplier: 0.08, icon: "42", rollMode: "numbers", condition: (ctx) => ctx.sequence.includes("42") },
  { id: "error_404", name: "Error 404", description: "The number lane contains 404.", rarity: "rare", value: 0, numberMultiplier: 0.12, icon: "404", rollMode: "numbers", condition: (ctx) => ctx.sequence.includes("404") },
  { id: "prime_chain_2357", name: "Prime Chain", description: "The number lane contains 2357.", rarity: "epic", value: 0, numberMultiplier: 0.24, icon: "2357", rollMode: "numbers", condition: (ctx) => ctx.sequence.includes("2357") },
  { id: "golden_ratio", name: "Golden Ratio", description: "The number lane contains 1618.", rarity: "epic", value: 0, numberMultiplier: 0.28, icon: "1618", rollMode: "numbers", condition: (ctx) => ctx.sequence.includes("1618") },
  { id: "six_digit_palindrome", name: "Six-Digit Mirror", description: "A 6-digit number lane mirrors perfectly.", rarity: "legendary", value: 0, numberMultiplier: 0.3, icon: "6#M", rollMode: "numbers", condition: (ctx) => ctx.numberCount === 6 && ctx.sequence === reverseString(ctx.sequence) },
  { id: "same_digit_six", name: "Digit Singularity", description: "All 6 number tiles are the same digit.", rarity: "mythic", value: 0, numberMultiplier: 0.9, icon: "6#X", rollMode: "numbers", condition: (ctx) => ctx.numberCount === 6 && ctx.maxCount === 6 },
  { id: "ascending_digit_relic", name: "Ascending Digit Relic", description: "The number lane rolls a full 6-digit ascending straight.", rarity: "mythic", value: 0, numberMultiplier: 0.55, icon: "012", rollMode: "numbers", condition: (ctx) => /012345|123456|234567|345678|456789/.test(ctx.sequence) },
  { id: "descending_digit_relic", name: "Descending Digit Relic", description: "The number lane rolls a full 6-digit descending straight.", rarity: "mythic", value: 0, numberMultiplier: 0.55, icon: "987", rollMode: "numbers", condition: (ctx) => /987654|876543|765432|654321|543210/.test(ctx.sequence) },
  { id: "binary_alternator", name: "Binary Alternator", description: "The number lane rolls 101010 or 010101.", rarity: "mythic", value: 0, numberMultiplier: 0.45, icon: "1010", rollMode: "numbers", condition: (ctx) => ctx.sequence === "101010" || ctx.sequence === "010101" },
  { id: "pi_relic", name: "Pi Relic", description: "The number lane rolls 314159 exactly.", rarity: "glitched", value: 0, numberMultiplier: 1.1, icon: "PI", rollMode: "numbers", condition: (ctx) => ctx.sequence === "314159" },
  { id: "euler_relic", name: "Euler Relic", description: "The number lane rolls 271828 exactly.", rarity: "glitched", value: 0, numberMultiplier: 1.1, icon: "E", rollMode: "numbers", condition: (ctx) => ctx.sequence === "271828" },
  { id: "void_000000", name: "Void 000000", description: "The number lane rolls six zeroes.", rarity: "glitched", value: 0, numberMultiplier: 1.4, icon: "000", rollMode: "numbers", condition: (ctx) => ctx.sequence === "000000" },
  { id: "heaven_777777", name: "Heaven 777777", description: "The number lane rolls six sevens.", rarity: "glitched", value: 0, numberMultiplier: 1.5, icon: "777", rollMode: "numbers", condition: (ctx) => ctx.sequence === "777777" },
  { id: "fives_555555", name: "Fivefold Vault", description: "The number lane rolls six fives.", rarity: "glitched", value: 0, numberMultiplier: 1.25, icon: "555", rollMode: "numbers", condition: (ctx) => ctx.sequence === "555555" },
  { id: "checksum_36", name: "Checksum 36", description: "The digit sum equals exactly 36.", rarity: "epic", value: 0, numberMultiplier: 0.18, icon: "S36", rollMode: "numbers", condition: (ctx) => ctx.digitSum === 36 },
  { id: "checksum_45", name: "Checksum 45", description: "The digit sum equals exactly 45.", rarity: "legendary", value: 0, numberMultiplier: 0.36, icon: "S45", rollMode: "numbers", condition: (ctx) => ctx.digitSum === 45 }
);

const MEGA_ALPHA_WORD_RELICS = [
  {
    id: "mega_word_able",
    word: "ABLE",
    name: "Able Relic",
    rarity: "rare",
    value: 980,
    icon: "ABLE",
  },
  {
    id: "mega_word_aura",
    word: "AURA",
    name: "Aura Relic",
    rarity: "rare",
    value: 980,
    icon: "AURA",
  },
  {
    id: "mega_word_bolt",
    word: "BOLT",
    name: "Bolt Relic",
    rarity: "rare",
    value: 1020,
    icon: "BOLT",
  },
  {
    id: "mega_word_core",
    word: "CORE",
    name: "Core Relic",
    rarity: "rare",
    value: 1040,
    icon: "CORE",
  },
  {
    id: "mega_word_dice",
    word: "DICE",
    name: "Dice Relic",
    rarity: "rare",
    value: 1080,
    icon: "DICE",
  },
  {
    id: "mega_word_echo",
    word: "ECHO",
    name: "Echo Relic",
    rarity: "rare",
    value: 1100,
    icon: "ECHO",
  },
  {
    id: "mega_word_flux",
    word: "FLUX",
    name: "Flux Relic",
    rarity: "epic",
    value: 1450,
    icon: "FLUX",
  },
  {
    id: "mega_word_haze",
    word: "HAZE",
    name: "Haze Relic",
    rarity: "rare",
    value: 1180,
    icon: "HAZE",
  },
  {
    id: "mega_word_iris",
    word: "IRIS",
    name: "Iris Relic",
    rarity: "rare",
    value: 1160,
    icon: "IRIS",
  },
  {
    id: "mega_word_jade",
    word: "JADE",
    name: "Jade Relic",
    rarity: "epic",
    value: 1480,
    icon: "JADE",
  },
  {
    id: "mega_word_kilo",
    word: "KILO",
    name: "Kilo Relic",
    rarity: "rare",
    value: 1120,
    icon: "KILO",
  },
  {
    id: "mega_word_luna",
    word: "LUNA",
    name: "Luna Relic",
    rarity: "rare",
    value: 1220,
    icon: "LUNA",
  },
  {
    id: "mega_word_mint",
    word: "MINT",
    name: "Mint Relic",
    rarity: "rare",
    value: 1060,
    icon: "MINT",
  },
  {
    id: "mega_word_nova",
    word: "NOVA",
    name: "Nova Relic",
    rarity: "epic",
    value: 1500,
    icon: "NOVA",
  },
  {
    id: "mega_word_quad",
    word: "QUAD",
    name: "Quad Relic",
    rarity: "epic",
    value: 1580,
    icon: "QUAD",
  },
  {
    id: "mega_word_rift",
    word: "RIFT",
    name: "Rift Relic",
    rarity: "epic",
    value: 1620,
    icon: "RIFT",
  },
  {
    id: "mega_word_sage",
    word: "SAGE",
    name: "Sage Relic",
    rarity: "rare",
    value: 1240,
    icon: "SAGE",
  },
  {
    id: "mega_word_tide",
    word: "TIDE",
    name: "Tide Relic",
    rarity: "rare",
    value: 1080,
    icon: "TIDE",
  },
  {
    id: "mega_word_vibe",
    word: "VIBE",
    name: "Vibe Relic",
    rarity: "rare",
    value: 1160,
    icon: "VIBE",
  },
  {
    id: "mega_word_wave",
    word: "WAVE",
    name: "Wave Relic",
    rarity: "rare",
    value: 1180,
    icon: "WAVE",
  },
  {
    id: "mega_word_xeno",
    word: "XENO",
    name: "Xeno Relic",
    rarity: "epic",
    value: 1720,
    icon: "XENO",
  },
  {
    id: "mega_word_yarn",
    word: "YARN",
    name: "Yarn Relic",
    rarity: "rare",
    value: 1040,
    icon: "YARN",
  },
  {
    id: "mega_word_zest",
    word: "ZEST",
    name: "Zest Relic",
    rarity: "epic",
    value: 1680,
    icon: "ZEST",
  },
  {
    id: "mega_word_alpha",
    word: "ALPHA",
    name: "Alpha Prime Relic",
    rarity: "mythic",
    value: 6200,
    icon: "ALP",
  },
  {
    id: "mega_word_blade",
    word: "BLADE",
    name: "Blade Relic",
    rarity: "legendary",
    value: 4200,
    icon: "BLD",
  },
  {
    id: "mega_word_brave",
    word: "BRAVE",
    name: "Brave Relic",
    rarity: "legendary",
    value: 3900,
    icon: "BRV",
  },
  {
    id: "mega_word_crown",
    word: "CROWN",
    name: "Crown Relic",
    rarity: "legendary",
    value: 4600,
    icon: "CRN",
  },
  {
    id: "mega_word_delta",
    word: "DELTA",
    name: "Delta Relic",
    rarity: "legendary",
    value: 4300,
    icon: "DLT",
  },
  {
    id: "mega_word_dream",
    word: "DREAM",
    name: "Dream Relic",
    rarity: "legendary",
    value: 4100,
    icon: "DRM",
  },
  {
    id: "mega_word_eagle",
    word: "EAGLE",
    name: "Eagle Relic",
    rarity: "legendary",
    value: 4200,
    icon: "EGL",
  },
  {
    id: "mega_word_ember",
    word: "EMBER",
    name: "Ember Relic",
    rarity: "legendary",
    value: 4400,
    icon: "EMB",
  },
  {
    id: "mega_word_flare",
    word: "FLARE",
    name: "Flare Relic",
    rarity: "legendary",
    value: 4500,
    icon: "FLR",
  },
  {
    id: "mega_word_frost",
    word: "FROST",
    name: "Frost Relic",
    rarity: "legendary",
    value: 4300,
    icon: "FRS",
  },
  {
    id: "mega_word_ghost",
    word: "GHOST",
    name: "Ghost Relic",
    rarity: "mythic",
    value: 6800,
    icon: "GHO",
  },
  {
    id: "mega_word_glyph",
    word: "GLYPH",
    name: "Glyph Prime Relic",
    rarity: "mythic",
    value: 7600,
    icon: "GLY",
  },
  {
    id: "mega_word_honey",
    word: "HONEY",
    name: "Honey Relic",
    rarity: "legendary",
    value: 3900,
    icon: "HNY",
  },
  {
    id: "mega_word_index",
    word: "INDEX",
    name: "Index Relic",
    rarity: "legendary",
    value: 4100,
    icon: "IDX",
  },
  {
    id: "mega_word_jolly",
    word: "JOLLY",
    name: "Jolly Relic",
    rarity: "legendary",
    value: 4000,
    icon: "JLY",
  },
  {
    id: "mega_word_knife",
    word: "KNIFE",
    name: "Knife Relic",
    rarity: "legendary",
    value: 4400,
    icon: "KNF",
  },
  {
    id: "mega_word_lucky",
    word: "LUCKY",
    name: "Lucky Relic",
    rarity: "mythic",
    value: 7000,
    icon: "LCK",
  },
  {
    id: "mega_word_magic",
    word: "MAGIC",
    name: "Magic Relic",
    rarity: "mythic",
    value: 7200,
    icon: "MAG",
  },
  {
    id: "mega_word_nexus",
    word: "NEXUS",
    name: "Nexus Relic",
    rarity: "mythic",
    value: 7600,
    icon: "NXS",
  },
  {
    id: "mega_word_orbit",
    word: "ORBIT",
    name: "Orbit Relic",
    rarity: "legendary",
    value: 4600,
    icon: "ORB",
  },
  {
    id: "mega_word_pixel",
    word: "PIXEL",
    name: "Pixel Relic",
    rarity: "legendary",
    value: 4300,
    icon: "PXL",
  },
  {
    id: "mega_word_quart",
    word: "QUART",
    name: "Quart Relic",
    rarity: "mythic",
    value: 7800,
    icon: "QRT",
  },
  {
    id: "mega_word_river",
    word: "RIVER",
    name: "River Relic",
    rarity: "legendary",
    value: 4000,
    icon: "RVR",
  },
  {
    id: "mega_word_solar",
    word: "SOLAR",
    name: "Solar Relic",
    rarity: "legendary",
    value: 4500,
    icon: "SOL",
  },
  {
    id: "mega_word_tempo",
    word: "TEMPO",
    name: "Tempo Relic",
    rarity: "legendary",
    value: 4100,
    icon: "TMP",
  },
  {
    id: "mega_word_unity",
    word: "UNITY",
    name: "Unity Relic",
    rarity: "legendary",
    value: 4300,
    icon: "UNI",
  },
  {
    id: "mega_word_vivid",
    word: "VIVID",
    name: "Vivid Relic",
    rarity: "legendary",
    value: 4400,
    icon: "VIV",
  },
  {
    id: "mega_word_whirl",
    word: "WHIRL",
    name: "Whirl Relic",
    rarity: "legendary",
    value: 4300,
    icon: "WHR",
  },
  {
    id: "mega_word_xenon",
    word: "XENON",
    name: "Xenon Relic",
    rarity: "mythic",
    value: 8200,
    icon: "XEN",
  },
  {
    id: "mega_word_zebra",
    word: "ZEBRA",
    name: "Zebra Relic",
    rarity: "legendary",
    value: 4700,
    icon: "ZBR",
  },
  {
    id: "mega_word_anchor",
    word: "ANCHOR",
    name: "Anchor Relic",
    rarity: "mythic",
    value: 12000,
    icon: "ANC",
  },
  {
    id: "mega_word_arcane",
    word: "ARCANE",
    name: "Arcane Relic",
    rarity: "mythic",
    value: 13500,
    icon: "ARC",
  },
  {
    id: "mega_word_badges",
    word: "BADGES",
    name: "Badge Relic",
    rarity: "mythic",
    value: 12800,
    icon: "BDG",
  },
  {
    id: "mega_word_binary",
    word: "BINARY",
    name: "Binary Relic",
    rarity: "mythic",
    value: 13000,
    icon: "BIN",
  },
  {
    id: "mega_word_bright",
    word: "BRIGHT",
    name: "Bright Relic",
    rarity: "mythic",
    value: 12400,
    icon: "BRT",
  },
  {
    id: "mega_word_candle",
    word: "CANDLE",
    name: "Candle Relic",
    rarity: "mythic",
    value: 11800,
    icon: "CND",
  },
  {
    id: "mega_word_castle",
    word: "CASTLE",
    name: "Castle Relic",
    rarity: "mythic",
    value: 12200,
    icon: "CST",
  },
  {
    id: "mega_word_charge",
    word: "CHARGE",
    name: "Charge Relic",
    rarity: "mythic",
    value: 12600,
    icon: "CHG",
  },
  {
    id: "mega_word_coding",
    word: "CODING",
    name: "Coding Relic",
    rarity: "mythic",
    value: 13400,
    icon: "COD",
  },
  {
    id: "mega_word_cosmic",
    word: "COSMIC",
    name: "Cosmic Prime Relic",
    rarity: "glitched",
    value: 46000,
    icon: "COS",
  },
  {
    id: "mega_word_crystal",
    word: "CRYSTAL",
    name: "Crystal Relic",
    rarity: "glitched",
    value: 52000,
    icon: "CRY",
  },
  {
    id: "mega_word_dragon",
    word: "DRAGON",
    name: "Dragon Relic",
    rarity: "glitched",
    value: 54000,
    icon: "DRG",
  },
  {
    id: "mega_word_energy",
    word: "ENERGY",
    name: "Energy Relic",
    rarity: "mythic",
    value: 13800,
    icon: "NRG",
  },
  {
    id: "mega_word_factor",
    word: "FACTOR",
    name: "Factor Relic",
    rarity: "mythic",
    value: 12600,
    icon: "FAC",
  },
  {
    id: "mega_word_future",
    word: "FUTURE",
    name: "Future Relic",
    rarity: "mythic",
    value: 13600,
    icon: "FTR",
  },
  {
    id: "mega_word_galaxy",
    word: "GALAXY",
    name: "Galaxy Relic",
    rarity: "glitched",
    value: 56000,
    icon: "GAL",
  },
  {
    id: "mega_word_glitch",
    word: "GLITCH",
    name: "Glitch Prime Relic",
    rarity: "glitched",
    value: 64000,
    icon: "GLT",
  },
  {
    id: "mega_word_golden",
    word: "GOLDEN",
    name: "Golden Relic",
    rarity: "mythic",
    value: 14200,
    icon: "GLD",
  },
  {
    id: "mega_word_hammer",
    word: "HAMMER",
    name: "Hammer Relic",
    rarity: "mythic",
    value: 13000,
    icon: "HMR",
  },
  {
    id: "mega_word_hunter",
    word: "HUNTER",
    name: "Hunter Relic",
    rarity: "mythic",
    value: 13200,
    icon: "HNT",
  },
  {
    id: "mega_word_island",
    word: "ISLAND",
    name: "Island Relic",
    rarity: "mythic",
    value: 12800,
    icon: "ISL",
  },
  {
    id: "mega_word_jungle",
    word: "JUNGLE",
    name: "Jungle Relic",
    rarity: "glitched",
    value: 48000,
    icon: "JNG",
  },
  {
    id: "mega_word_knight",
    word: "KNIGHT",
    name: "Knight Relic",
    rarity: "mythic",
    value: 14800,
    icon: "KNT",
  },
  {
    id: "mega_word_letter",
    word: "LETTER",
    name: "Letter Relic",
    rarity: "mythic",
    value: 12400,
    icon: "LTR",
  },
  {
    id: "mega_word_matrix",
    word: "MATRIX",
    name: "Matrix Relic",
    rarity: "glitched",
    value: 58000,
    icon: "MTX",
  },
  {
    id: "mega_word_memory",
    word: "MEMORY",
    name: "Memory Relic",
    rarity: "mythic",
    value: 12600,
    icon: "MEM",
  },
  {
    id: "mega_word_mystic",
    word: "MYSTIC",
    name: "Mystic Prime Relic",
    rarity: "glitched",
    value: 60000,
    icon: "MYS",
  },
  {
    id: "mega_word_number",
    word: "NUMBER",
    name: "Number Relic",
    rarity: "mythic",
    value: 13200,
    icon: "NUM",
  },
  {
    id: "mega_word_oracle",
    word: "ORACLE",
    name: "Oracle Prime Relic",
    rarity: "glitched",
    value: 62000,
    icon: "ORA",
  },
  {
    id: "mega_word_planet",
    word: "PLANET",
    name: "Planet Relic",
    rarity: "mythic",
    value: 13000,
    icon: "PLN",
  },
  {
    id: "mega_word_random",
    word: "RANDOM",
    name: "Random Relic",
    rarity: "mythic",
    value: 14000,
    icon: "RNG",
  },
  {
    id: "mega_word_reward",
    word: "REWARD",
    name: "Reward Relic",
    rarity: "mythic",
    value: 14200,
    icon: "RWD",
  },
  {
    id: "mega_word_vector",
    word: "VECTOR",
    name: "Vector Relic",
    rarity: "mythic",
    value: 13600,
    icon: "VEC",
  },
  {
    id: "mega_word_violet",
    word: "VIOLET",
    name: "Violet Relic",
    rarity: "mythic",
    value: 13400,
    icon: "VIO",
  },
  {
    id: "mega_word_wizard",
    word: "WIZARD",
    name: "Wizard Relic",
    rarity: "glitched",
    value: 50000,
    icon: "WIZ",
  },
  {
    id: "mega_word_wonder",
    word: "WONDER",
    name: "Wonder Relic",
    rarity: "mythic",
    value: 13200,
    icon: "WND",
  },
];

const MEGA_ALPHA_FRAGMENT_RELICS = [
  { id: "fragment_qu", fragment: "QU", name: "Quark Fragment", rarity: "rare", value: 520, icon: "QU" },
  { id: "fragment_xz", fragment: "XZ", name: "X-Z Fragment", rarity: "epic", value: 940, icon: "XZ" },
  { id: "fragment_jq", fragment: "JQ", name: "J-Q Fragment", rarity: "epic", value: 980, icon: "JQ" },
  { id: "fragment_zq", fragment: "ZQ", name: "Z-Q Fragment", rarity: "epic", value: 1020, icon: "ZQ" },
  { id: "fragment_qx", fragment: "QX", name: "Q-X Fragment", rarity: "epic", value: 1040, icon: "QX" },
  { id: "fragment_aei", fragment: "AEI", name: "Vowel Prism", rarity: "legendary", value: 2300, icon: "AEI" },
  { id: "fragment_eio", fragment: "EIO", name: "Echo Prism", rarity: "legendary", value: 2300, icon: "EIO" },
  { id: "fragment_oua", fragment: "OUA", name: "Orbital Prism", rarity: "legendary", value: 2300, icon: "OUA" },
  { id: "fragment_rng", fragment: "RNG", name: "RNG Fragment", rarity: "mythic", value: 7600, icon: "RNG" },
  { id: "fragment_gem", fragment: "GEM", name: "Gem Fragment", rarity: "legendary", value: 2600, icon: "GEM" },
  { id: "fragment_ai", fragment: "AI", name: "AI Fragment", rarity: "rare", value: 720, icon: "AI" },
  { id: "fragment_zz", fragment: "ZZ", name: "Double Z Fragment", rarity: "epic", value: 1260, icon: "ZZ" },
  { id: "fragment_qq", fragment: "QQ", name: "Double Q Fragment", rarity: "epic", value: 1320, icon: "QQ" },
  { id: "fragment_xx", fragment: "XX", name: "Double X Fragment", rarity: "epic", value: 1260, icon: "XX" },
  { id: "fragment_jj", fragment: "JJ", name: "Double J Fragment", rarity: "epic", value: 1220, icon: "JJ" },
  { id: "fragment_abcde", fragment: "ABCDE", name: "Five-Step Ascension", rarity: "mythic", value: 8800, icon: "A-E" },
  { id: "fragment_vwxyz", fragment: "VWXYZ", name: "Five-Step Zenith", rarity: "mythic", value: 9000, icon: "V-Z" },
  { id: "fragment_cdefg", fragment: "CDEFG", name: "Chromatic Ladder", rarity: "mythic", value: 8400, icon: "C-G" },
  { id: "fragment_zyxwv", fragment: "ZYXWV", name: "Reverse Zenith", rarity: "mythic", value: 9100, icon: "Z-V" },
  { id: "fragment_myth", fragment: "MYTH", name: "Myth Fragment", rarity: "legendary", value: 3400, icon: "MYTH" },
  { id: "fragment_void", fragment: "VOID", name: "Void Fragment", rarity: "legendary", value: 3600, icon: "VOID" },
  { id: "fragment_luck", fragment: "LUCK", name: "Luck Fragment", rarity: "legendary", value: 3800, icon: "LUCK" },
  { id: "fragment_roll", fragment: "ROLL", name: "Roll Fragment", rarity: "legendary", value: 3200, icon: "ROLL" },
  { id: "fragment_blue", fragment: "BLUE", name: "Blue Fragment", rarity: "legendary", value: 3000, icon: "BLUE" },
  { id: "fragment_glow", fragment: "GLOW", name: "Glow Fragment", rarity: "legendary", value: 3300, icon: "GLOW" },
  { id: "fragment_core", fragment: "CORE", name: "Core Fragment", rarity: "legendary", value: 3400, icon: "CORE" },
  { id: "fragment_star", fragment: "STAR", name: "Star Fragment", rarity: "legendary", value: 3500, icon: "STAR" },
  { id: "fragment_moon", fragment: "MOON", name: "Moon Fragment", rarity: "legendary", value: 3500, icon: "MOON" },
  { id: "fragment_sun", fragment: "SUN", name: "Sun Fragment", rarity: "epic", value: 1600, icon: "SUN" },
  { id: "fragment_sky", fragment: "SKY", name: "Sky Fragment", rarity: "epic", value: 1550, icon: "SKY" },
];

const MEGA_ALPHA_SIGMA_RELICS = [
  { id: "sigma_21", target: 21, rarity: "rare", value: 620 },
  { id: "sigma_34", target: 34, rarity: "rare", value: 680 },
  { id: "sigma_55", target: 55, rarity: "epic", value: 1250 },
  { id: "sigma_64", target: 64, rarity: "epic", value: 1320 },
  { id: "sigma_72", target: 72, rarity: "epic", value: 1380 },
  { id: "sigma_88", target: 88, rarity: "legendary", value: 2400 },
  { id: "sigma_99", target: 99, rarity: "legendary", value: 2600 },
  { id: "sigma_108", target: 108, rarity: "legendary", value: 2800 },
  { id: "sigma_123_mega", target: 123, rarity: "mythic", value: 7600 },
  { id: "sigma_144", target: 144, rarity: "mythic", value: 8200 },
  { id: "sigma_156", target: 156, rarity: "glitched", value: 32000 },
];

const MEGA_NUMBER_CODE_RELICS = [
  { id: "mega_num_01", pattern: "01", mode: "contains", name: "Origin Code", rarity: "common", boost: 0.04, icon: "01" },
  { id: "mega_num_10", pattern: "10", mode: "contains", name: "Return Code", rarity: "common", boost: 0.04, icon: "10" },
  { id: "mega_num_12", pattern: "12", mode: "contains", name: "Step Code", rarity: "common", boost: 0.04, icon: "12" },
  { id: "mega_num_21", pattern: "21", mode: "contains", name: "Mirror Step Code", rarity: "common", boost: 0.04, icon: "21" },
  { id: "mega_num_23", pattern: "23", mode: "contains", name: "Prime Step Code", rarity: "common", boost: 0.05, icon: "23" },
  { id: "mega_num_32", pattern: "32", mode: "contains", name: "Reverse Prime Code", rarity: "common", boost: 0.05, icon: "32" },
  { id: "mega_num_45", pattern: "45", mode: "contains", name: "Lift Code", rarity: "common", boost: 0.05, icon: "45" },
  { id: "mega_num_54", pattern: "54", mode: "contains", name: "Drop Code", rarity: "common", boost: 0.05, icon: "54" },
  { id: "mega_num_89", pattern: "89", mode: "contains", name: "High Step Code", rarity: "uncommon", boost: 0.06, icon: "89" },
  { id: "mega_num_98", pattern: "98", mode: "contains", name: "Falling Step Code", rarity: "uncommon", boost: 0.06, icon: "98" },
  { id: "mega_num_007", pattern: "007", mode: "contains", name: "Agent Code", rarity: "rare", boost: 0.12, icon: "007" },
  { id: "mega_num_101", pattern: "101", mode: "contains", name: "Binary Door", rarity: "rare", boost: 0.1, icon: "101" },
  { id: "mega_num_111", pattern: "111", mode: "contains", name: "Triple One", rarity: "rare", boost: 0.12, icon: "111" },
  { id: "mega_num_222", pattern: "222", mode: "contains", name: "Triple Two", rarity: "rare", boost: 0.12, icon: "222" },
  { id: "mega_num_333", pattern: "333", mode: "contains", name: "Triple Three", rarity: "rare", boost: 0.12, icon: "333" },
  { id: "mega_num_444", pattern: "444", mode: "contains", name: "Triple Four", rarity: "rare", boost: 0.12, icon: "444" },
  { id: "mega_num_555", pattern: "555", mode: "contains", name: "Triple Five", rarity: "epic", boost: 0.16, icon: "555" },
  { id: "mega_num_666", pattern: "666", mode: "contains", name: "Triple Six", rarity: "epic", boost: 0.18, icon: "666" },
  { id: "mega_num_808", pattern: "808", mode: "contains", name: "Bass Gate", rarity: "rare", boost: 0.11, icon: "808" },
  { id: "mega_num_909", pattern: "909", mode: "contains", name: "Echo Gate", rarity: "rare", boost: 0.11, icon: "909" },
  { id: "mega_num_1337", pattern: "1337", mode: "contains", name: "Elite Code", rarity: "legendary", boost: 0.26, icon: "1337" },
  { id: "mega_num_2024", pattern: "2024", mode: "contains", name: "Archive 2024", rarity: "epic", boost: 0.2, icon: "2024" },
  { id: "mega_num_2025", pattern: "2025", mode: "contains", name: "Archive 2025", rarity: "epic", boost: 0.2, icon: "2025" },
  { id: "mega_num_2026", pattern: "2026", mode: "contains", name: "Archive 2026", rarity: "legendary", boost: 0.28, icon: "2026" },
  { id: "mega_num_2048", pattern: "2048", mode: "contains", name: "Power Code", rarity: "legendary", boost: 0.3, icon: "2048" },
  { id: "mega_num_4096", pattern: "4096", mode: "contains", name: "Deep Power Code", rarity: "legendary", boost: 0.32, icon: "4096" },
  { id: "mega_num_9001", pattern: "9001", mode: "contains", name: "Overlimit Code", rarity: "mythic", boost: 0.42, icon: "9001" },
  { id: "mega_num_1212", pattern: "1212", mode: "contains", name: "Twin Pulse", rarity: "epic", boost: 0.22, icon: "1212" },
  { id: "mega_num_3434", pattern: "3434", mode: "contains", name: "Double Ladder", rarity: "epic", boost: 0.22, icon: "3434" },
  { id: "mega_num_5656", pattern: "5656", mode: "contains", name: "Relay Ladder", rarity: "epic", boost: 0.22, icon: "5656" },
  { id: "mega_num_12345", pattern: "12345", mode: "exact", name: "Five-Step Digit Relic", rarity: "mythic", boost: 0.6, icon: "12345" },
  { id: "mega_num_54321", pattern: "54321", mode: "exact", name: "Reverse Five-Step Relic", rarity: "mythic", boost: 0.6, icon: "54321" },
  { id: "mega_num_13579", pattern: "13579", mode: "exact", name: "Odd Royal Flush", rarity: "mythic", boost: 0.65, icon: "13579" },
  { id: "mega_num_24680", pattern: "24680", mode: "exact", name: "Even Royal Flush", rarity: "mythic", boost: 0.65, icon: "24680" },
  { id: "mega_num_112358", pattern: "112358", mode: "exact", name: "True Fibonacci Relic", rarity: "glitched", boost: 1.3, icon: "FIB" },
  { id: "mega_num_161803", pattern: "161803", mode: "exact", name: "Golden Spiral Relic", rarity: "glitched", boost: 1.25, icon: "PHI" },
  { id: "mega_num_424242", pattern: "424242", mode: "exact", name: "Answer Echo", rarity: "glitched", boost: 1.2, icon: "42X" },
  { id: "mega_num_123456", pattern: "123456", mode: "exact", name: "Perfect Digit Ascent", rarity: "glitched", boost: 1.4, icon: "ASC" },
  { id: "mega_num_654321", pattern: "654321", mode: "exact", name: "Perfect Digit Descent", rarity: "glitched", boost: 1.4, icon: "DSC" },
];

MEGA_ALPHA_WORD_RELICS.forEach((relic) => {
  BADGES.push({
    id: relic.id,
    name: relic.name,
    description: `Roll ${relic.word} exactly on the alphabet lane.`,
    rarity: relic.rarity,
    value: relic.value,
    icon: relic.icon,
    relicWord: relic.word,
    rollMode: "letters",
    condition: (ctx) => ctx.sequence === relic.word,
  });
});

MEGA_ALPHA_FRAGMENT_RELICS.forEach((relic) => {
  BADGES.push({
    id: relic.id,
    name: relic.name,
    description: `The alphabet lane contains ${relic.fragment}.`,
    rarity: relic.rarity,
    value: relic.value,
    icon: relic.icon,
    fragment: relic.fragment,
    rollMode: "letters",
    condition: (ctx) => ctx.sequence.includes(relic.fragment),
  });
});

MEGA_ALPHA_SIGMA_RELICS.forEach((relic) => {
  BADGES.push({
    id: relic.id,
    name: `Sigma ${relic.target}`,
    description: `Alphabet-position total equals exactly ${relic.target}.`,
    rarity: relic.rarity,
    value: relic.value,
    icon: `S${relic.target}`,
    sigmaTarget: relic.target,
    rollMode: "letters",
    condition: (ctx) => ctx.alphaScore === relic.target,
  });
});

MEGA_NUMBER_CODE_RELICS.forEach((relic) => {
  BADGES.push({
    id: relic.id,
    name: relic.name,
    description: relic.mode === "exact"
      ? `The number lane rolls ${relic.pattern} exactly.`
      : `The number lane contains ${relic.pattern}.`,
    rarity: relic.rarity,
    value: 0,
    numberMultiplier: relic.boost,
    icon: relic.icon,
    pattern: relic.pattern,
    patternMode: relic.mode,
    rollMode: "numbers",
    condition: (ctx) => {
      if (!ctx.isNumberRoll) return false;
      if (relic.mode === "exact") return ctx.sequence === relic.pattern;
      return ctx.sequence.includes(relic.pattern);
    },
  });
});

BADGES.forEach((badge) => {
  if (Number(badge.numberMultiplier || 0) > 0 || badge.rollMode === "numbers" || badge.requiresMixed) {
    badge.value = 0;
  }
});

applyProbabilityEconomy(BADGES);

function applyProbabilityEconomy(badges) {
  // Keep server startup fast. Exact probability formulas are resolved lazily
  // for badges that are actually earned during a roll.
  badges.forEach((badge) => {
    const digitBadge = isNumberBadge(badge);
    const originalRarity = badge.rarity;
    const chance = getFastBadgeDropChance(badge, originalRarity);

    badge.baseRarity = originalRarity;
    badge.dropChance = chance;
    badge.dropChanceExact = false;
    badge.dropChanceResolved = false;
    badge.dropChanceLabel = getNonPercentOddsLabel(badge);
    badge.rarity = getRarityFromDropChance(chance);

    if (digitBadge) {
      badge.value = 0;
    } else {
      badge.value = getGlyphValueFromDropChance(chance);
    }
  });
}

function getFastBadgeDropChance(badge, fallbackRarity) {
  if (MANUAL_BADGE_DROP_CHANCES[badge.id]) return MANUAL_BADGE_DROP_CHANCES[badge.id];
  return FALLBACK_CHANCE_BY_RARITY[fallbackRarity] || FALLBACK_CHANCE_BY_RARITY.common;
}

function ensureBadgeEconomy(badge) {
  if (!badge || badge.dropChanceResolved) return badge;

  const digitBadge = isNumberBadge(badge);
  const originalRarity = badge.baseRarity || badge.rarity;
  const chance = getEstimatedBadgeDropChance(badge, digitBadge, originalRarity);
  const exactOdds = hasExactOddsForBadge(badge, digitBadge);

  badge.dropChance = chance;
  badge.dropChanceExact = exactOdds;
  badge.dropChanceResolved = true;
  badge.dropChanceLabel = exactOdds ? formatDropChanceLabel(chance) : getNonPercentOddsLabel(badge);
  badge.rarity = getRarityFromDropChance(chance);
  badge.value = digitBadge ? 0 : getGlyphValueFromDropChance(chance);

  return badge;
}

function hasExactOddsForBadge(badge, digitBadge) {
  const lengths = digitBadge ? [2, 3, 4, 6] : [4, 5, 6];
  return lengths.some((length) => {
    const chance = getFormulaBadgeDropChanceForLength(badge, length, digitBadge);
    return chance !== null && chance > 0;
  });
}

function getNonPercentOddsLabel(badge) {
  const source = String(badge.condition || "");
  if (/gemini|source\s*={2,3}\s*["'`]gemini["'`]/i.test(`${badge.id} ${source}`)) return "AI checked";
  if (/words|longestWordLength|fullSequenceWord|wordCoverage/.test(source)) return "Dictionary";
  if (/glitchedBonus|luckSurge|mythicPulse|cosmicPulse|realityRift|abyssalJackpot/.test(source)) return "Random";
  return "Complex rule";
}

function getEstimatedBadgeDropChance(badge, digitBadge, fallbackRarity) {
  if (MANUAL_BADGE_DROP_CHANCES[badge.id]) return MANUAL_BADGE_DROP_CHANCES[badge.id];

  const cacheKey = `economy:${badge.id}:${digitBadge ? "D" : "L"}`;
  if (economyChanceCache.has(cacheKey)) return economyChanceCache.get(cacheKey);

  const lengths = digitBadge ? [2, 3, 4, 6] : [4, 5, 6];
  let bestChance = 0;

  lengths.forEach((length) => {
    const formulaChance = getFormulaBadgeDropChanceForLength(badge, length, digitBadge);
    const chance = formulaChance === null ? 0 : formulaChance;
    if (chance > bestChance) bestChance = chance;
  });

  if (!bestChance) {
    bestChance = FALLBACK_CHANCE_BY_RARITY[fallbackRarity] || FALLBACK_CHANCE_BY_RARITY.common;
  }

  bestChance = clamp(bestChance, 0.000000001, 1);
  economyChanceCache.set(cacheKey, bestChance);
  return bestChance;
}

function getFormulaBadgeDropChanceForLength(badge, length, digitBadge) {
  const alphabetSize = digitBadge ? 10 : 26;
  const source = String(badge.condition || "");
  const requiredLength = getRequiredSequenceLength(source);
  if (requiredLength && length !== requiredLength) return 0;
  if (requiredLength && isSimpleLengthCondition(source)) return 1;
  const laneLengthGate = getLaneLengthGate(source, length, digitBadge);
  if (laneLengthGate === 0) return 0;
  if (laneLengthGate === 1 && isSimpleLaneLengthCondition(source, digitBadge)) return 1;

  if (!isFormulaTrustedBadge(badge)) return null;

  if (badge.relicWord) {
    return length === badge.relicWord.length ? 1 / Math.pow(26, badge.relicWord.length) : 0;
  }

  if (badge.fragment) {
    if (digitBadge || length < badge.fragment.length) return 0;
    return getContainsAnyPatternChance([badge.fragment], length, LETTERS);
  }

  if (badge.pattern && digitBadge) {
    if (length < badge.pattern.length) return 0;
    if (badge.patternMode === "exact") {
      return length === badge.pattern.length ? 1 / Math.pow(10, badge.pattern.length) : 0;
    }
    return getContainsAnyPatternChance([badge.pattern], length, "0123456789");
  }

  const alphaModulo = !digitBadge ? getModuloConditionTarget(badge, "alphaScore") : null;
  if (alphaModulo) {
    return getAlphaModuloChance(length, alphaModulo.modulo, alphaModulo.target);
  }

  const alphaTarget = !digitBadge ? getNumericConditionTarget(badge, "alphaScore") || badge.sigmaTarget : 0;
  if (alphaTarget) {
    return getAlphaSumChance(length, alphaTarget);
  }

  const digitTarget = digitBadge ? getNumericConditionTarget(badge, "digitSum") : 0;
  if (digitTarget || digitTarget === 0) {
    const source = String(badge.condition || "");
    if (/ctx\.digitSum\s*={2,3}\s*\d+/.test(source)) {
      return getDigitSumChance(length, digitTarget);
    }
  }

  const digitModulo = digitBadge ? getModuloConditionTarget(badge, "digitSum") : null;
  if (digitModulo) {
    const zeroExcluded = /ctx\.digitSum\s*>\s*0/.test(source) && digitModulo.target % digitModulo.modulo === 0;
    const zeroSequenceChance = zeroExcluded ? Math.pow(10, -length) : 0;
    return clamp(getDigitModuloChance(length, digitModulo.modulo, digitModulo.target) - zeroSequenceChance, 0, 1);
  }

  const simpleChance = getSimpleConditionChance(badge, length, digitBadge, alphabetSize, source);
  if (simpleChance !== null) return simpleChance;

  const maxCountChance = getMaxCountConditionChance(badge, length, alphabetSize);
  if (maxCountChance !== null) return maxCountChance;

  const exactSequences = getExactSequenceCandidates(badge, digitBadge);
  if (exactSequences.length) {
    const matching = exactSequences.filter((sequence) => sequence.length === length);
    return matching.length ? Math.min(1, matching.length / Math.pow(alphabetSize, length)) : 0;
  }

  const includePatterns = getIncludesPatternCandidates(badge, digitBadge);
  if (includePatterns.length) {
    const alphabet = digitBadge ? "0123456789" : LETTERS;
    return getContainsAnyPatternChance(includePatterns, length, alphabet);
  }

  const literalPatterns = getLiteralPatternCandidates(badge, digitBadge);
  if (literalPatterns.length) {
    const alphabet = digitBadge ? "0123456789" : LETTERS;
    return getContainsAnyPatternChance(literalPatterns, length, alphabet);
  }

  return null;
}

function isFormulaTrustedBadge(badge) {
  return Boolean(
    badge.relicWord ||
    badge.fragment ||
    badge.pattern ||
    badge.sigmaTarget ||
    EXACT_FORMULA_BADGE_IDS.has(badge.id)
  );
}

function estimateBadgeChanceBySampling(badge, length, digitBadge) {
  const cacheKey = `sample:${badge.id}:${digitBadge ? "D" : "L"}:${length}`;
  if (economyChanceCache.has(cacheKey)) return economyChanceCache.get(cacheKey);

  const samples = digitBadge ? ECONOMY_ODDS_SAMPLES.numbers : ECONOMY_ODDS_SAMPLES.letters;
  const alphabet = digitBadge ? "0123456789" : LETTERS;
  const derived = { luck: 0, rollMode: digitBadge ? "numbers" : "letters" };
  let hits = 0;

  for (let sample = 0; sample < samples; sample += 1) {
    const sequence = generateEconomyOddsSequence(alphabet, length, sample, digitBadge ? 131 : 67);
    const ctx = buildRollContext(sequence, derived, digitBadge ? [] : findWords(sequence));
    ctx.glitchedBonus = false;
    ctx.luckSurge = false;
    ctx.mythicPulse = false;
    ctx.cosmicPulse = false;
    ctx.realityRift = false;
    ctx.abyssalJackpot = false;
    try {
      if (badge.condition(ctx)) hits += 1;
    } catch {
      // Conditions that need live AI or random state fall back to manual/rarity odds.
    }
  }

  const chance = hits / samples;
  economyChanceCache.set(cacheKey, chance);
  return chance;
}

function getRarityFromDropChance(chance) {
  return (PROBABILITY_RARITY_BANDS.find((band) => chance <= band.maxChance) || PROBABILITY_RARITY_BANDS[PROBABILITY_RARITY_BANDS.length - 1]).rarity;
}

function getGlyphValueFromDropChance(chance) {
  const scarcity = Math.max(0.05, -Math.log10(clamp(chance, 0.000000001, 1)));
  const raw = 12 + Math.pow(scarcity + 0.25, 3.15) * 75;
  return Math.max(5, Math.min(250000, Math.round(raw / 5) * 5));
}

function getNumericConditionTarget(badge, field) {
  const source = String(badge.condition || "");
  const match = source.match(new RegExp(`ctx\\.${field}\\s*={2,3}\\s*(\\d+)`));
  return match ? Number(match[1]) : 0;
}

function getModuloConditionTarget(badge, field) {
  const source = String(badge.condition || "");
  const match = source.match(new RegExp(`ctx\\.${field}\\s*%\\s*(\\d+)\\s*={2,3}\\s*(\\d+)`));
  return match ? { modulo: Number(match[1]), target: Number(match[2]) } : null;
}

function getRequiredSequenceLength(source) {
  const match = source.match(/ctx\.sequence\.length\s*={2,3}\s*(\d+)/);
  return match ? Number(match[1]) : 0;
}

function isSimpleLengthCondition(source) {
  return /=>\s*ctx\.sequence\.length\s*={2,3}\s*\d+\s*[,}]?\s*$/.test(source);
}

function getLaneLengthGate(source, length, digitBadge) {
  const field = digitBadge ? "numberCount" : "letterCount";
  const exactPattern = new RegExp(`ctx\\.${field}\\s*={2,3}\\s*(\\d+)`, "g");
  const minPattern = new RegExp(`ctx\\.${field}\\s*>=\\s*(\\d+)`, "g");
  let match;

  while ((match = exactPattern.exec(source))) {
    if (length !== Number(match[1])) return 0;
  }

  while ((match = minPattern.exec(source))) {
    if (length < Number(match[1])) return 0;
  }

  if (new RegExp(`ctx\\.${field}\\s*>\\s*0`).test(source) && length <= 0) return 0;
  return 1;
}

function isSimpleLaneLengthCondition(source, digitBadge) {
  const field = digitBadge ? "numberCount" : "letterCount";
  return new RegExp(`=>\\s*ctx\\.${field}\\s*(?:>=|={2,3}|>)\\s*\\d+\\s*[,}]?\\s*$`).test(source);
}

function getSimpleConditionChance(badge, length, digitBadge, alphabetSize, source) {
  if (/ctx\.uniqueCount\s*={2,3}\s*ctx\.sequence\.length/.test(source)) {
    return getAllUniqueChance(length, alphabetSize);
  }

  if (/ctx\.digitUniqueCount\s*={2,3}\s*(\d+)/.test(source)) {
    const target = Number(source.match(/ctx\.digitUniqueCount\s*={2,3}\s*(\d+)/)[1]);
    return getUniqueCountExactChance(length, alphabetSize, target);
  }

  if (/ctx\.digitUniqueCount\s*>=\s*(\d+)/.test(source)) {
    const target = Number(source.match(/ctx\.digitUniqueCount\s*>=\s*(\d+)/)[1]);
    return getUniqueCountAtLeastChance(length, alphabetSize, target);
  }

  if (/ctx\.vowelCount\s*={2,3}\s*0/.test(source)) return Math.pow(21 / 26, length);
  if (/ctx\.vowelCount\s*>=\s*(\d+)/.test(source)) {
    return getBinomialAtLeastChance(length, 5 / 26, Number(source.match(/ctx\.vowelCount\s*>=\s*(\d+)/)[1]));
  }
  if (/ctx\.vowelCount\s*={2,3}\s*ctx\.letterCount/.test(source)) return Math.pow(5 / 26, length);
  if (/ctx\.consonantCount\s*>=\s*(\d+)/.test(source)) {
    return getBinomialAtLeastChance(length, 21 / 26, Number(source.match(/ctx\.consonantCount\s*>=\s*(\d+)/)[1]));
  }

  if (/ctx\.highCount\s*>=\s*Math\.ceil\(ctx\.letterCount\s*\*\s*0\.66\)/.test(source)) {
    return getBinomialAtLeastChance(length, 0.5, Math.ceil(length * 0.66));
  }
  if (/ctx\.lowCount\s*>=\s*Math\.ceil\(ctx\.letterCount\s*\*\s*0\.66\)/.test(source)) {
    return getBinomialAtLeastChance(length, 0.5, Math.ceil(length * 0.66));
  }
  if (/ctx\.highCount\s*={2,3}\s*ctx\.letterCount/.test(source)) return Math.pow(0.5, length);
  if (/ctx\.lowCount\s*={2,3}\s*ctx\.letterCount/.test(source)) return Math.pow(0.5, length);
  if (/ctx\.highCount\s*={2,3}\s*ctx\.lowCount/.test(source)) {
    return length % 2 === 0 ? combination(length, length / 2) * Math.pow(0.5, length) : 0;
  }

  if (/ctx\.sequence\s*={2,3}\s*reverseString\(ctx\.sequence\)/.test(source)) {
    return Math.pow(alphabetSize, Math.ceil(length / 2)) / Math.pow(alphabetSize, length);
  }

  if (/ctx\.firstChar\s*={2,3}\s*ctx\.lastChar|ctx\.sequence\[0\]\s*={2,3}\s*ctx\.sequence\[ctx\.sequence\.length\s*-\s*1\]/.test(source)) {
    return length >= 2 ? 1 / alphabetSize : 0;
  }

  if (/ctx\.rareLetterCount\s*>=\s*(\d+)/.test(source)) {
    return getBinomialAtLeastChance(length, 4 / 26, Number(source.match(/ctx\.rareLetterCount\s*>=\s*(\d+)/)[1]));
  }

  if (/ctx\.sequence\.includes\("A"\)\s*&&\s*ctx\.sequence\.includes\("Z"\)/.test(source)) {
    return 1 - 2 * Math.pow(25 / 26, length) + Math.pow(24 / 26, length);
  }

  if (/ctx\.sequence\.includes\("Q"\)\s*&&\s*!ctx\.sequence\.includes\("U"\)/.test(source)) {
    return Math.pow(25 / 26, length) - Math.pow(24 / 26, length);
  }

  const singleIncludes = source.match(/ctx\.sequence\.includes\("([A-Z0-9])"\)/);
  if (singleIncludes && !source.includes("&&")) {
    return 1 - Math.pow((alphabetSize - 1) / alphabetSize, length);
  }

  if (/ctx\.allEvenDigits/.test(source) || /ctx\.allOddDigits/.test(source)) return Math.pow(0.5, length);
  if (/ctx\.digitSum\s*%\s*2\s*={2,3}\s*[01]/.test(source)) return length > 0 ? 0.5 : 0;
  if (/Number\(ctx\.firstChar\)\s*>\s*Number\(ctx\.lastChar\)|Number\(ctx\.firstChar\)\s*<\s*Number\(ctx\.lastChar\)/.test(source)) {
    return digitBadge && length >= 2 ? 0.45 : 0;
  }

  const longestWordGate = source.match(/ctx\.longestWordLength\s*>=\s*(\d+)/);
  if (longestWordGate && length < Number(longestWordGate[1])) return 0;

  return null;
}

function getAllUniqueChance(length, alphabetSize) {
  if (length > alphabetSize) return 0;
  let favorable = 1;
  for (let index = 0; index < length; index += 1) favorable *= alphabetSize - index;
  return favorable / Math.pow(alphabetSize, length);
}

function getUniqueCountExactChance(length, alphabetSize, target) {
  if (target < 1 || target > length || target > alphabetSize) return 0;
  return combination(alphabetSize, target) * targetFactorialSurjections(length, target) / Math.pow(alphabetSize, length);
}

function getUniqueCountAtLeastChance(length, alphabetSize, target) {
  let chance = 0;
  for (let count = target; count <= Math.min(length, alphabetSize); count += 1) {
    chance += getUniqueCountExactChance(length, alphabetSize, count);
  }
  return clamp(chance, 0, 1);
}

function targetFactorialSurjections(length, target) {
  let total = 0;
  for (let index = 0; index <= target; index += 1) {
    total += ((index % 2 === 0 ? 1 : -1) * combination(target, index) * Math.pow(target - index, length));
  }
  return total;
}

function getBinomialAtLeastChance(trials, successChance, threshold) {
  let chance = 0;
  for (let hits = Math.max(0, threshold); hits <= trials; hits += 1) {
    chance += combination(trials, hits) * Math.pow(successChance, hits) * Math.pow(1 - successChance, trials - hits);
  }
  return clamp(chance, 0, 1);
}

function getExactSequenceCandidates(badge, digitBadge) {
  const source = String(badge.condition || "");
  const domain = digitBadge ? /^[0-9]+$/ : /^[A-Z]+$/;
  const candidates = new Set();
  const patterns = [
    /ctx\.sequence\s*={2,3}\s*["'`]([A-Z0-9]+)["'`]/g,
    /["'`]([A-Z0-9]+)["'`]\s*={2,3}\s*ctx\.sequence/g,
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(source))) {
      if (domain.test(match[1])) candidates.add(match[1]);
    }
  });

  return Array.from(candidates);
}

function getIncludesPatternCandidates(badge, digitBadge) {
  const source = String(badge.condition || "");
  const domain = digitBadge ? /^[0-9]+$/ : /^[A-Z]+$/;
  const candidates = new Set();
  const includePattern = /ctx\.sequence\.includes\(["'`]([A-Z0-9]+)["'`]\)/g;
  let match;

  while ((match = includePattern.exec(source))) {
    if (domain.test(match[1])) candidates.add(match[1]);
  }

  return Array.from(candidates);
}

function getLiteralPatternCandidates(badge, digitBadge) {
  const source = String(badge.condition || "");
  const domain = digitBadge ? /^[0-9]+$/ : /^[A-Z]+$/;
  const candidates = new Set();
  const regexPattern = /\/([A-Z0-9|]+)\/\.test\(ctx\.sequence\)/g;
  let match;

  while ((match = regexPattern.exec(source))) {
    match[1].split("|").forEach((piece) => {
      if (piece && domain.test(piece)) candidates.add(piece);
    });
  }

  return Array.from(candidates);
}

function getContainsAnyPatternChance(patterns, length, alphabet) {
  const usablePatterns = Array.from(new Set(patterns))
    .filter((pattern) => pattern && pattern.length <= length);
  if (!usablePatterns.length) return 0;

  const cacheKey = `contains:${alphabet}:${length}:${usablePatterns.sort().join("|")}`;
  if (economyChanceCache.has(cacheKey)) return economyChanceCache.get(cacheKey);

  const maxSuffixLength = Math.max(...usablePatterns.map((pattern) => pattern.length)) - 1;
  let states = new Map([["", 1]]);

  for (let index = 0; index < length; index += 1) {
    const next = new Map();
    states.forEach((count, suffix) => {
      for (const char of alphabet) {
        const candidate = `${suffix}${char}`;
        if (usablePatterns.some((pattern) => candidate.endsWith(pattern))) continue;
        const nextSuffix = maxSuffixLength > 0 ? candidate.slice(-maxSuffixLength) : "";
        next.set(nextSuffix, (next.get(nextSuffix) || 0) + count);
      }
    });
    states = next;
  }

  const avoidCount = Array.from(states.values()).reduce((sum, count) => sum + count, 0);
  const totalCount = Math.pow(alphabet.length, length);
  const chance = clamp(1 - avoidCount / totalCount, 0, 1);
  economyChanceCache.set(cacheKey, chance);
  return chance;
}

function getMaxCountConditionChance(badge, length, alphabetSize) {
  const source = String(badge.condition || "");

  if (/ctx\.maxCount\s*={2,3}\s*ctx\.sequence\.length/.test(source)) {
    return Math.pow(alphabetSize, 1 - length);
  }

  const exact = source.match(/ctx\.maxCount\s*={2,3}\s*(\d+)/);
  if (exact) {
    return getMaxCountExactChance(length, alphabetSize, Number(exact[1]));
  }

  const atLeast = source.match(/ctx\.maxCount\s*>=\s*(\d+)/);
  if (atLeast) {
    return getMaxCountAtLeastChance(length, alphabetSize, Number(atLeast[1]));
  }

  return null;
}

function getMaxCountAtLeastChance(length, alphabetSize, threshold) {
  if (threshold <= 1) return 1;
  if (threshold > length) return 0;
  const total = Math.pow(alphabetSize, length);
  return clamp(1 - getMaxCountAtMostCount(length, alphabetSize, threshold - 1) / total, 0, 1);
}

function getMaxCountExactChance(length, alphabetSize, target) {
  if (target < 1 || target > length) return 0;
  const total = Math.pow(alphabetSize, length);
  const exact = getMaxCountAtMostCount(length, alphabetSize, target) -
    getMaxCountAtMostCount(length, alphabetSize, target - 1);
  return clamp(exact / total, 0, 1);
}

function getMaxCountAtMostCount(length, alphabetSize, cap) {
  const cacheKey = `max-count:${length}:${alphabetSize}:${cap}`;
  if (economyChanceCache.has(cacheKey)) return economyChanceCache.get(cacheKey);
  if (cap <= 0) return 0;
  if (cap >= length) return Math.pow(alphabetSize, length);

  let total = 0;
  for (let unique = 1; unique <= length; unique += 1) {
    const countPatterns = [];
    collectCountPatterns(length, unique, cap, [], countPatterns);
    countPatterns.forEach((counts) => {
      const arrangements = factorial(length) / counts.reduce((product, count) => product * factorial(count), 1);
      total += combination(alphabetSize, unique) * arrangements;
    });
  }

  economyChanceCache.set(cacheKey, total);
  return total;
}

function collectCountPatterns(remaining, slots, cap, current, output) {
  if (slots === 0) {
    if (remaining === 0) output.push([...current]);
    return;
  }

  const minNeeded = slots - 1;
  for (let count = 1; count <= Math.min(cap, remaining - minNeeded); count += 1) {
    current.push(count);
    collectCountPatterns(remaining - count, slots - 1, cap, current, output);
    current.pop();
  }
}

function combination(n, r) {
  if (r < 0 || r > n) return 0;
  return factorial(n) / (factorial(r) * factorial(n - r));
}

function factorial(value) {
  let result = 1;
  for (let index = 2; index <= value; index += 1) result *= index;
  return result;
}

function getAlphaSumChance(length, target) {
  const cacheKey = `alpha-sum:${length}:${target}`;
  if (economyChanceCache.has(cacheKey)) return economyChanceCache.get(cacheKey);

  let ways = { 0: 1 };
  for (let index = 0; index < length; index += 1) {
    const next = {};
    Object.entries(ways).forEach(([sum, count]) => {
      for (let value = 1; value <= 26; value += 1) {
        const total = Number(sum) + value;
        next[total] = (next[total] || 0) + count;
      }
    });
    ways = next;
  }

  const chance = (ways[target] || 0) / Math.pow(26, length);
  economyChanceCache.set(cacheKey, chance);
  return chance;
}

function getAlphaModuloChance(length, modulo, target) {
  const normalizedTarget = ((target % modulo) + modulo) % modulo;
  const cacheKey = `alpha-mod:${length}:${modulo}:${normalizedTarget}`;
  if (economyChanceCache.has(cacheKey)) return economyChanceCache.get(cacheKey);

  let ways = Array.from({ length: modulo }, () => 0);
  ways[0] = 1;

  for (let index = 0; index < length; index += 1) {
    const next = Array.from({ length: modulo }, () => 0);
    ways.forEach((count, remainder) => {
      if (!count) return;
      for (let value = 1; value <= 26; value += 1) {
        next[(remainder + value) % modulo] += count;
      }
    });
    ways = next;
  }

  const chance = ways[normalizedTarget] / Math.pow(26, length);
  economyChanceCache.set(cacheKey, chance);
  return chance;
}

function getDigitSumChance(length, target) {
  const cacheKey = `digit-sum:${length}:${target}`;
  if (economyChanceCache.has(cacheKey)) return economyChanceCache.get(cacheKey);

  let ways = { 0: 1 };
  for (let index = 0; index < length; index += 1) {
    const next = {};
    Object.entries(ways).forEach(([sum, count]) => {
      for (let value = 0; value <= 9; value += 1) {
        const total = Number(sum) + value;
        next[total] = (next[total] || 0) + count;
      }
    });
    ways = next;
  }

  const chance = (ways[target] || 0) / Math.pow(10, length);
  economyChanceCache.set(cacheKey, chance);
  return chance;
}

function getDigitModuloChance(length, modulo, target) {
  const normalizedTarget = ((target % modulo) + modulo) % modulo;
  const cacheKey = `digit-mod:${length}:${modulo}:${normalizedTarget}`;
  if (economyChanceCache.has(cacheKey)) return economyChanceCache.get(cacheKey);

  let ways = Array.from({ length: modulo }, () => 0);
  ways[0] = 1;

  for (let index = 0; index < length; index += 1) {
    const next = Array.from({ length: modulo }, () => 0);
    ways.forEach((count, remainder) => {
      if (!count) return;
      for (let value = 0; value <= 9; value += 1) {
        next[(remainder + value) % modulo] += count;
      }
    });
    ways = next;
  }

  const chance = ways[normalizedTarget] / Math.pow(10, length);
  economyChanceCache.set(cacheKey, chance);
  return chance;
}

function generateEconomyOddsSequence(alphabet, length, sample, salt) {
  let value = (sample + 1) * 2654435761 + salt * 1013904223;
  let sequence = "";
  for (let index = 0; index < length; index += 1) {
    value = (Math.imul(value ^ (index + 17), 1664525) + 1013904223) >>> 0;
    sequence += alphabet[value % alphabet.length];
  }
  return sequence;
}

function formatDropChanceLabel(chance) {
  if (!Number.isFinite(chance) || chance <= 0) return "0%";
  if (chance < 0.0001) return `1 / ${Math.max(1, Math.round(1 / chance)).toLocaleString()}`;
  const percent = chance * 100;
  if (percent < 0.01) return formatPercent(percent, 5);
  if (percent < 1) return formatPercent(percent, 4);
  return formatPercent(percent, 3);
}

function formatPercent(percent, digits = 2) {
  return `${percent.toFixed(digits).replace(/\.?0+$/, "")}%`;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(createEmptyDb(), null, 2));
  }
}

function createEmptyDb() {
  return { users: {}, sessions: {}, pendingCodes: {}, magicLinks: {}, leaderboard: [] };
}

function readDb() {
  ensureDb();
  return normalizeDb(JSON.parse(fs.readFileSync(DB_PATH, "utf8")));
}

function writeDb(db) {
  ensureDb();
  fs.writeFileSync(DB_PATH, JSON.stringify(normalizeDb(db), null, 2));
}

function normalizeDb(db) {
  return {
    ...createEmptyDb(),
    ...(db || {}),
    users: { ...(db?.users || {}) },
    sessions: { ...(db?.sessions || {}) },
    pendingCodes: { ...(db?.pendingCodes || {}) },
    magicLinks: { ...(db?.magicLinks || {}) },
    leaderboard: Array.isArray(db?.leaderboard) ? db.leaderboard : [],
  };
}

function sendJson(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...securityHeaders(),
    ...corsHeaders(),
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

function securityHeaders() {
  const connectSrc = ["'self'", ...String(process.env.CONNECT_SRC || "").split(/\s+/).filter(Boolean)].join(" ");
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      `connect-src ${connectSrc}`,
    ].join("; "),
  };

  if (process.env.NODE_ENV === "production") {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }

  return headers;
}

function corsHeaders() {
  const allowed = process.env.ALLOWED_ORIGIN;
  return allowed
    ? {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      }
    : {};
}

function isUnsafeMethod(method) {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method || "GET").toUpperCase());
}

function validateRequestOrigin(req) {
  if (!isUnsafeMethod(req.method)) return true;

  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "cross-site") return false;

  const origin = String(req.headers.origin || "");
  if (!origin) return true;

  return getAllowedOrigins(req).has(origin.replace(/\/+$/, ""));
}

function getAllowedOrigins(req) {
  return new Set([
    getRequestOrigin(req),
    String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
    String(process.env.ALLOWED_ORIGIN || "").replace(/\/+$/, ""),
  ].filter(Boolean));
}

function isJsonPost(req) {
  if (!isUnsafeMethod(req.method)) return true;
  return String(req.headers["content-type"] || "").toLowerCase().includes("application/json");
}

function checkRateLimit(req, pathname) {
  const limits = [
    { match: "/api/auth/magic/start", limit: Number(process.env.AUTH_RATE_LIMIT || 6), windowMs: 10 * 60_000 },
    { match: "/api/evaluate-roll", limit: Number(process.env.ROLL_RATE_LIMIT || 90), windowMs: RATE_LIMIT_WINDOW_MS },
    { match: "/api/ai/words", limit: Number(process.env.AI_RATE_LIMIT || 60), windowMs: RATE_LIMIT_WINDOW_MS },
    { match: "/api/leaderboard/scores", limit: Number(process.env.LEADERBOARD_RATE_LIMIT || 60), windowMs: RATE_LIMIT_WINDOW_MS },
  ];
  const rule = limits.find((item) => item.match === pathname) ||
    { match: "api", limit: Number(process.env.API_RATE_LIMIT || 240), windowMs: RATE_LIMIT_WINDOW_MS };
  const ip = getClientIp(req);
  const key = `${rule.match}:${ip}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + rule.windowMs };

  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + rule.windowMs;
  }

  bucket.count += 1;
  rateBuckets.set(key, bucket);
  pruneRateBuckets(now);

  if (bucket.count > rule.limit) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  }

  return 0;
}

function getClientIp(req) {
  if (process.env.TRUST_PROXY === "true") {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || "unknown";
}

function pruneRateBuckets(now) {
  if (rateBuckets.size < 1000) return;
  rateBuckets.forEach((bucket, key) => {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function getSessionContext(req, db) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || !db.sessions[token]) return null;
  const session = db.sessions[token];
  if (session.expiresAt < Date.now()) {
    delete db.sessions[token];
    writeDb(db);
    return null;
  }
  const user = db.users[session.userId] || null;
  if (!user) return null;
  if (!session.csrfToken) {
    session.csrfToken = crypto.randomBytes(32).toString("hex");
    writeDb(db);
  }
  return { token, session, user };
}

function getSessionUser(req, db) {
  return getSessionContext(req, db)?.user || null;
}

function requireCsrf(req, context) {
  if (!isUnsafeMethod(req.method)) return true;
  const expected = String(context?.session?.csrfToken || "");
  const provided = String(req.headers["x-csrf-token"] || "");
  if (!expected || !provided || expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const candidate = hashPassword(password, user.passwordSalt).hash;
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function makeSession(req, db, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  db.sessions[token] = {
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS,
    csrfToken: crypto.randomBytes(32).toString("hex"),
  };
  const secure = process.env.NODE_ENV === "production" || req.headers["x-forwarded-proto"] === "https";
  return {
    "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? "; Secure" : ""}`,
  };
}

function clearSessionCookie(req = { headers: {} }) {
  const secure = process.env.NODE_ENV === "production" || req.headers["x-forwarded-proto"] === "https";
  return {
    "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`,
  };
}

function safeUser(user, session = null) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isAdmin: isAdminEmail(user.email),
    createdAt: user.createdAt,
    bestRoll: user.bestRoll || null,
    csrfToken: session?.csrfToken || "",
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalizeEmail(email));
}

function isAdminEmail(email) {
  return ADMIN_EMAILS.has(normalizeEmail(email));
}

function cleanDisplayName(name) {
  return String(name || "Alpha Roller").trim().slice(0, 22) || "Alpha Roller";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function createMagicToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: hashMagicToken(token) };
}

function hashMagicToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function pruneExpiredMagicLinks(db) {
  const now = Date.now();
  Object.entries(db.magicLinks || {}).forEach(([hash, item]) => {
    if (!item || Number(item.expiresAt) < now) delete db.magicLinks[hash];
  });
}

function getRequestOrigin(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim() || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || `127.0.0.1:${PORT}`;
  return `${proto}://${host}`;
}

function getOrCreateUserByEmail(db, email, displayName) {
  let user = Object.values(db.users).find((item) => normalizeEmail(item.email) === email);
  if (user) {
    user.displayName = cleanDisplayName(displayName || user.displayName);
    delete user.passwordSalt;
    delete user.passwordHash;
    user.progress = sanitizePlayerProgress(user.progress || null);
    return user;
  }

  user = {
    id: crypto.randomUUID(),
    email,
    displayName: cleanDisplayName(displayName),
    createdAt: Date.now(),
    bestRoll: null,
    totalGlyphs: 0,
    totalRolls: 0,
    progress: null,
  };
  db.users[user.id] = user;
  return user;
}

function sanitizePlayerProgress(progress) {
  if (!progress || typeof progress !== "object") return null;

  return {
    version: Math.max(1, Math.floor(Number(progress.version) || 1)),
    glyphs: Math.max(0, Math.floor(Number(progress.glyphs) || 0)),
    totalGlyphs: Math.max(0, Math.floor(Number(progress.totalGlyphs) || 0)),
    totalRolls: Math.max(0, Math.floor(Number(progress.totalRolls) || 0)),
    lastRollAt: sanitizeTimestamp(progress.lastRollAt),
    nextRollAt: sanitizeTimestamp(progress.nextRollAt),
    badges: sanitizeBadgeProgress(progress.badges),
    upgrades: sanitizeUpgradeProgress(progress.upgrades),
    bestRoll: sanitizeRollSummary(progress.bestRoll),
    rarestBadgeId: normalizeBadgeIds([progress.rarestBadgeId])[0] || null,
    lastResult: sanitizeLastResult(progress.lastResult),
  };
}

function sanitizeTimestamp(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function sanitizeBadgeProgress(badges) {
  const clean = {};
  Object.entries(badges && typeof badges === "object" ? badges : {})
    .slice(0, 250)
    .forEach(([id, info]) => {
      const safeId = normalizeBadgeIds([id])[0];
      if (!safeId) return;
      clean[safeId] = {
        count: Math.max(0, Math.floor(Number(info?.count) || 0)),
        firstAt: sanitizeTimestamp(info?.firstAt),
        bestRoll: sanitizeRollSummary(info?.bestRoll),
      };
    });
  return clean;
}

function sanitizeUpgradeProgress(upgrades) {
  const clean = {};
  Object.entries(upgrades && typeof upgrades === "object" ? upgrades : {})
    .slice(0, 150)
    .forEach(([id, value]) => {
      const safeId = String(id || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 48);
      if (safeId && value === true && ACTIVE_UPGRADE_IDS.has(safeId)) clean[safeId] = true;
    });
  return clean;
}

function sanitizeRollSummary(roll) {
  if (!roll || typeof roll !== "object") return null;
  try {
    const sequence = normalizeSequence(roll.sequence);
    let parts = null;
    try {
      parts = normalizeRollParts(roll);
    } catch {
      parts = {
        sequence,
        letterSequence: sequence.replace(/[^A-Z]/g, ""),
        numberSequence: sequence.replace(/\D/g, ""),
      };
    }
    return {
      sequence: parts.sequence || sequence,
      letterSequence: parts.letterSequence,
      numberSequence: parts.numberSequence,
      glyphsEarned: Math.max(0, Math.floor(Number(roll.glyphsEarned || roll.glyphs) || 0)),
      tier: TIER_ORDER.includes(roll.tier) ? roll.tier : "common",
      badgeCount: Math.max(0, Math.floor(Number(roll.badgeCount || roll.badges) || 0)),
      at: sanitizeTimestamp(roll.at),
    };
  } catch {
    return null;
  }
}

function sanitizeLastResult(result) {
  if (!result || typeof result !== "object") return null;
  const summary = sanitizeRollSummary(result);
  if (!summary) return null;
  return {
    ...summary,
    baseGlyphs: Math.max(0, Math.floor(Number(result.baseGlyphs) || 0)),
    badgeGlyphs: Math.max(0, Math.floor(Number(result.badgeGlyphs) || 0)),
    alphabetBadgeGlyphs: Math.max(0, Math.floor(Number(result.alphabetBadgeGlyphs) || 0)),
    badgeGlyphsBoosted: Math.max(0, Math.floor(Number(result.badgeGlyphsBoosted) || 0)),
    autoClaimBonus: Math.max(0, Math.floor(Number(result.autoClaimBonus) || 0)),
    numberMultiplier: Math.max(1, Number(result.numberMultiplier) || 1),
    numberMultiplierBonus: Math.max(0, Number(result.numberMultiplierBonus) || 0),
    numberBoostEarned: Math.max(0, Number(result.numberBoostEarned) || 0),
    rollMode: "combo",
    words: Array.isArray(result.words) ? result.words.slice(0, 12) : [],
    earnedBadges: Array.isArray(result.earnedBadges)
      ? result.earnedBadges.slice(0, 20).map((badge) => ({
          id: normalizeBadgeIds([badge?.id])[0] || "",
          name: String(badge?.name || "").slice(0, 40),
          description: String(badge?.description || "").slice(0, 140),
          rarity: RARITIES[badge?.rarity] ? badge.rarity : "common",
          value: Math.max(0, Math.floor(Number(badge?.value) || 0)),
          numberMultiplier: Math.max(0, Number(badge?.numberMultiplier) || 0),
          icon: String(badge?.icon || "◆").slice(0, 4),
          isNew: Boolean(badge?.isNew),
        })).filter((badge) => badge.id)
      : [],
    glowingIndexes: Array.isArray(result.glowingIndexes)
      ? result.glowingIndexes.slice(0, 12).map((item) => Math.max(0, Math.floor(Number(item) || 0)))
      : [],
    geminiUsed: Boolean(result.geminiUsed),
  };
}

async function handleApi(req, res, pathname) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...securityHeaders(), ...corsHeaders() });
    res.end();
    return;
  }

  if (!validateRequestOrigin(req)) {
    sendJson(res, 403, { error: "Cross-site requests are not allowed" });
    return;
  }

  if (!isJsonPost(req)) {
    sendJson(res, 415, { error: "API POST requests must use application/json" });
    return;
  }

  const retryAfter = checkRateLimit(req, pathname);
  if (retryAfter) {
    sendJson(res, 429, { error: "Too many requests. Please slow down for a moment." }, {
      "Retry-After": String(retryAfter),
    });
    return;
  }

  try {
    if (pathname === "/api/health" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
        emailConfigured: hasEmailTransport(),
        authMode: "magic-link",
      });
      return;
    }

    if (pathname === "/api/me" && req.method === "GET") {
      const db = readDb();
      const context = getSessionContext(req, db);
      sendJson(res, 200, { user: safeUser(context?.user, context?.session) });
      return;
    }

    if (pathname === "/api/progress" && req.method === "GET") {
      const db = readDb();
      const user = getSessionUser(req, db);
      if (!user) return sendJson(res, 401, { error: "Sign in required" });
      sendJson(res, 200, { progress: sanitizePlayerProgress(user.progress || null) });
      return;
    }

    if (pathname === "/api/progress" && req.method === "POST") {
      const body = await readBody(req);
      const db = readDb();
      const context = getSessionContext(req, db);
      const user = context?.user;
      if (!user) return sendJson(res, 401, { error: "Sign in required" });
      if (!requireCsrf(req, context)) return sendJson(res, 403, { error: "Invalid security token" });
      user.progress = sanitizePlayerProgress(body.progress || body);
      user.totalGlyphs = Math.max(user.totalGlyphs || 0, Number(user.progress.totalGlyphs) || 0);
      user.totalRolls = Math.max(user.totalRolls || 0, Number(user.progress.totalRolls) || 0);
      if (user.progress.bestRoll) user.bestRoll = user.progress.bestRoll;
      writeDb(db);
      sendJson(res, 200, { ok: true, progress: user.progress });
      return;
    }

    if (pathname === "/api/auth/magic/start" && req.method === "POST") {
      const body = await readBody(req);
      const email = normalizeEmail(body.email);
      const displayName = cleanDisplayName(body.displayName);
      if (!isValidEmail(email)) return sendJson(res, 400, { error: "Valid email address required" });

      const db = readDb();
      pruneExpiredMagicLinks(db);
      const { token, tokenHash } = createMagicToken();
      db.magicLinks[tokenHash] = {
        email,
        displayName,
        expiresAt: Date.now() + MAGIC_LINK_TTL_MS,
      };
      writeDb(db);

      const magicLink = `${getRequestOrigin(req)}/auth/magic?token=${encodeURIComponent(token)}`;
      const emailSent = await sendMagicLinkEmail(email, magicLink);
      const includeDevLink = process.env.RETURN_DEV_MAGIC_LINKS === "true" || (!emailSent && process.env.NODE_ENV !== "production");
      sendJson(res, 200, {
        ok: true,
        emailSent,
        devLink: includeDevLink ? magicLink : undefined,
        message: emailSent ? "Magic link sent" : "Magic link generated in development mode",
      });
      return;
    }

    if ((pathname === "/api/auth/start" || pathname === "/api/auth/verify") && req.method === "POST") {
      sendJson(res, 410, {
        error: "Password and 2-step-code auth has been retired. Use /api/auth/magic/start.",
      });
      return;
    }

    if (pathname === "/api/auth/start" && req.method === "POST") {
      const body = await readBody(req);
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) return sendJson(res, 400, { error: "Valid email address required" });

      const db = readDb();
      const code = String(100000 + crypto.randomInt(900000));
      db.pendingCodes[email] = { code, expiresAt: Date.now() + TWO_STEP_TTL_MS };
      writeDb(db);

      const emailSent = await sendTwoFactorEmail(email, code);
      const includeDevCode = process.env.RETURN_DEV_2FA_CODES === "true" || (!emailSent && process.env.NODE_ENV !== "production");
      sendJson(res, 200, {
        ok: true,
        emailSent,
        devCode: includeDevCode ? code : undefined,
        message: emailSent ? "2-step code sent" : "2-step code generated in development mode",
      });
      return;
    }

    if (pathname === "/api/auth/verify" && req.method === "POST") {
      const body = await readBody(req);
      const email = normalizeEmail(body.email);
      const displayName = cleanDisplayName(body.displayName);
      const password = String(body.password || "");
      const code = String(body.code || "").trim();
      if (!email || password.length < 6) return sendJson(res, 400, { error: "Email and 6+ character password required" });

      const db = readDb();
      const pending = db.pendingCodes[email];
      if (!pending || pending.expiresAt < Date.now() || pending.code !== code) {
        return sendJson(res, 401, { error: "Invalid or expired 2-step code" });
      }

      let user = Object.values(db.users).find((item) => item.email === email);
      if (user) {
        if (!verifyPassword(password, user)) return sendJson(res, 401, { error: "Invalid password" });
        user.displayName = displayName;
      } else {
        const { salt, hash } = hashPassword(password);
        user = {
          id: crypto.randomUUID(),
          email,
          displayName,
          passwordSalt: salt,
          passwordHash: hash,
          createdAt: Date.now(),
          bestRoll: null,
          totalGlyphs: 0,
          totalRolls: 0,
        };
        db.users[user.id] = user;
      }

      delete db.pendingCodes[email];
      const headers = makeSession(req, db, user.id);
      writeDb(db);
      const context = getSessionContext({ ...req, headers: { ...req.headers, cookie: headers["Set-Cookie"] } }, db);
      sendJson(res, 200, { ok: true, user: safeUser(user, context?.session) }, headers);
      return;
    }

    if (pathname === "/api/auth/logout" && req.method === "POST") {
      const db = readDb();
      const token = parseCookies(req)[SESSION_COOKIE];
      const context = getSessionContext(req, db);
      if (context && !requireCsrf(req, context)) return sendJson(res, 403, { error: "Invalid security token" });
      if (token) delete db.sessions[token];
      writeDb(db);
      sendJson(res, 200, { ok: true }, clearSessionCookie(req));
      return;
    }

    if (pathname === "/api/ai/words" && req.method === "POST") {
      const body = await readBody(req);
      const sequence = normalizeSequence(body.sequence);
      const localWords = findWords(sequence);
      const gemini = await askGemini(sequence);
      sendJson(res, 200, {
        words: mergeWordLists(localWords, gemini.words || []),
        geminiUsed: gemini.used,
      });
      return;
    }

    if (pathname === "/api/evaluate-roll" && req.method === "POST") {
      const body = await readBody(req);
      const roll = normalizeRollParts(body);
      const derived = sanitizeDerived(body.derived || {});
      const knownBadgeIds = Array.isArray(body.knownBadgeIds) ? body.knownBadgeIds.map(String) : [];
      const result = await evaluateSequence(roll, derived, knownBadgeIds);
      sendJson(res, 200, result);
      return;
    }

    if (pathname === "/api/leaderboard" && req.method === "GET") {
      const db = readDb();
      const boards = buildLeaderboardBoards(db);
      sendJson(res, 200, { rows: boards.allTime, boards });
      return;
    }

    if (pathname === "/api/leaderboard/scores" && req.method === "POST") {
      const body = await readBody(req);
      const db = readDb();
      const context = getSessionContext(req, db);
      const user = context?.user;
      if (!user) return sendJson(res, 401, { error: "Sign in required for global leaderboard" });
      if (!requireCsrf(req, context)) return sendJson(res, 403, { error: "Invalid security token" });
      const row = sanitizeLeaderboardRow(body, user);
      if (!row) return sendJson(res, 400, { error: "Valid leaderboard score required" });

      db.leaderboard = addLeaderboardRoll(db.leaderboard || [], row);
      if (user && (!user.bestRoll || row.glyphs > Number(user.bestRoll.glyphsEarned || user.bestRoll.glyphs || 0))) {
        user.bestRoll = {
          sequence: row.sequence,
          tier: row.tier,
          glyphsEarned: row.glyphs,
          badgeCount: row.badges,
          at: row.at,
        };
      }
      user.totalGlyphs = Math.max(user.totalGlyphs || 0, Math.floor(Number(body.totalGlyphs) || 0));
      user.totalRolls = Math.max(user.totalRolls || 0, Math.floor(Number(body.totalRolls) || 0));
      writeDb(db);
      const boards = buildLeaderboardBoards(db);
      sendJson(res, 200, { ok: true, rows: boards.allTime, boards });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: process.env.NODE_ENV === "production" ? "Server error" : (error.message || "Server error") });
  }
}

async function sendTwoFactorEmail(email, code) {
  try {
    return await sendTransactionalEmail({
      to: email,
      subject: "Your AlphaRNG 2-step code",
      text: `Your AlphaRNG 2-step code is ${code}. It expires in 10 minutes.`,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#102033">
          <h2>AlphaRNG verification</h2>
          <p>Your code is:</p>
          <p style="font-size:28px;font-weight:900;letter-spacing:.12em">${escapeHtml(code)}</p>
          <p style="font-size:13px;color:#667085">It expires in 10 minutes.</p>
        </div>
      `,
    });
  } catch (error) {
    console.warn(`Could not send 2-step email: ${safeEmailError(error)}`);
    if (process.env.NODE_ENV !== "production") {
      console.log(`[AlphaRNG dev 2-step] ${email}: ${code}`);
    }
    return false;
  }
}

async function sendMagicLinkEmail(email, magicLink) {
  try {
    return await sendTransactionalEmail({
      to: email,
      subject: "Your AlphaRNG magic sign-in link",
      text: `Click this AlphaRNG magic link to sign in: ${magicLink}\n\nThis link expires in 15 minutes. If you did not request it, you can ignore this email.`,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#102033">
          <h2>Sign in to AlphaRNG</h2>
          <p>Click the secure magic link below to enter your account. It expires in 15 minutes.</p>
          <p><a href="${escapeHtml(magicLink)}" style="display:inline-block;padding:12px 18px;background:#1677ff;color:white;border-radius:12px;text-decoration:none;font-weight:800">Open AlphaRNG</a></p>
          <p style="font-size:13px;color:#667085">If you did not request this, you can ignore this email.</p>
        </div>
      `,
    });
  } catch (error) {
    console.warn(`Could not send magic link email: ${safeEmailError(error)}`);
    if (process.env.NODE_ENV !== "production") {
      console.log(`[AlphaRNG dev magic link] ${email}: ${magicLink}`);
    }
    return false;
  }
}

function safeEmailError(error) {
  const parts = [];
  collectEmailErrorParts(error, parts, 0);
  const raw = parts.length ? parts.join(" | ") : String(error || "unknown email error");
  return raw
    .replace(/token=[^&\s]+/gi, "token=[redacted]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]")
    .slice(0, 1200);
}

function collectEmailErrorParts(error, parts, depth) {
  if (!error || depth > 2) return;
  const name = error.name || "Error";
  const message = error.message || String(error);
  const code = error.code ? ` code=${error.code}` : "";
  const command = error.command ? ` command=${error.command}` : "";
  const host = error.hostname || error.host ? ` host=${error.hostname || error.host}` : "";
  const port = error.port ? ` port=${error.port}` : "";
  parts.push(`${name}${code}${command}${host}${port}: ${message}`);
  if (Array.isArray(error.errors)) {
    for (const inner of error.errors.slice(0, 4)) collectEmailErrorParts(inner, parts, depth + 1);
  }
  if (error.cause) collectEmailErrorParts(error.cause, parts, depth + 1);
}

async function sendTransactionalEmail(message) {
  if (process.env.RESEND_API_KEY && process.env.TWO_FACTOR_FROM_EMAIL && typeof fetch === "function") {
    return sendResendEmail(message);
  }

  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    return sendSmtpEmail(message);
  }

  return false;
}

async function sendResendEmail({ to, subject, text, html }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: getEmailFromHeader(),
      to,
      subject,
      text,
      html,
    }),
  });
  if (!response.ok) {
    const providerText = await response.text().catch(() => "");
    throw new Error(`Resend returned ${response.status}: ${providerText.slice(0, 500)}`);
  }
  return true;
}

async function sendSmtpEmail({ to, subject, text, html }) {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = getEmailFromHeader();
  const fromAddress = extractEmailAddress(from);
  const toAddress = extractEmailAddress(to);
  if (!user || !pass || !fromAddress || !toAddress) return false;

  const socket = await new Promise((resolve, reject) => {
    const client = tls.connect({
      host,
      port,
      servername: host,
      rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== "false",
    }, () => resolve(client));
    client.setTimeout(Number(process.env.SMTP_TIMEOUT_MS || 12000), () => {
      client.destroy(new Error("SMTP connection timed out"));
    });
    client.once("error", reject);
  });

  try {
    await readSmtpResponse(socket, [220]);
    await smtpCommand(socket, `EHLO ${process.env.SMTP_EHLO_DOMAIN || "localhost"}`, [250]);
    await smtpCommand(socket, "AUTH LOGIN", [334]);
    await smtpCommand(socket, Buffer.from(user).toString("base64"), [334]);
    await smtpCommand(socket, Buffer.from(pass).toString("base64"), [235]);
    await smtpCommand(socket, `MAIL FROM:<${fromAddress}>`, [250]);
    await smtpCommand(socket, `RCPT TO:<${toAddress}>`, [250, 251]);
    await smtpCommand(socket, "DATA", [354]);

    socket.write(`${buildMimeEmail({ from, to, subject, text, html })}\r\n.\r\n`);
    await readSmtpResponse(socket, [250]);
    await smtpCommand(socket, "QUIT", [221]);
    return true;
  } finally {
    socket.end();
  }
}

function getEmailFromHeader() {
  return process.env.SMTP_FROM ||
    process.env.TWO_FACTOR_FROM_EMAIL ||
    (process.env.SMTP_USER ? `AlphaRNG <${process.env.SMTP_USER}>` : "AlphaRNG <no-reply@alpharng.local>");
}

function extractEmailAddress(value) {
  const text = String(value || "").trim();
  const angle = text.match(/<([^>]+)>/);
  const address = (angle ? angle[1] : text).trim();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) ? address : "";
}

function buildMimeEmail({ from, to, subject, text, html }) {
  const boundary = `alpharng-${crypto.randomBytes(12).toString("hex")}`;
  const safeSubject = String(subject || "AlphaRNG").replace(/[\r\n]+/g, " ").trim();
  const safeText = String(text || "").replace(/\r?\n/g, "\r\n");
  const safeHtml = String(html || escapeHtml(safeText)).replace(/\r?\n/g, "\r\n");

  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${safeSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    dotStuffSmtp(safeText),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    dotStuffSmtp(safeHtml),
    `--${boundary}--`,
  ].join("\r\n");
}

function dotStuffSmtp(content) {
  return String(content || "").split(/\r?\n/).map((line) => line.startsWith(".") ? `.${line}` : line).join("\r\n");
}

async function smtpCommand(socket, command, expectedCodes) {
  socket.write(`${command}\r\n`);
  return readSmtpResponse(socket, expectedCodes);
}

function readSmtpResponse(socket, expectedCodes) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => cleanup(new Error("SMTP response timed out")), Number(process.env.SMTP_TIMEOUT_MS || 12000));

    function cleanup(error, response) {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", onError);
      if (error) reject(error);
      else resolve(response);
    }

    function onError(error) {
      cleanup(error);
    }

    function onData(chunk) {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const lastLine = lines[lines.length - 1] || "";
      if (!/^\d{3} /.test(lastLine)) return;
      const code = Number(lastLine.slice(0, 3));
      if (!expectedCodes.includes(code)) {
        cleanup(new Error(`SMTP returned ${code}: ${buffer.trim()}`));
        return;
      }
      cleanup(null, { code, message: buffer.trim() });
    }

    socket.on("data", onData);
    socket.once("error", onError);
  });
}

function handleMagicLink(req, res, url) {
  const token = String(url.searchParams.get("token") || "");
  const db = readDb();
  pruneExpiredMagicLinks(db);

  const tokenHash = hashMagicToken(token);
  const pending = db.magicLinks[tokenHash];
  if (!pending || pending.expiresAt < Date.now()) {
    writeDb(db);
    res.writeHead(302, {
      Location: "/?auth=expired#account",
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }

  const user = getOrCreateUserByEmail(db, normalizeEmail(pending.email), pending.displayName);
  delete db.magicLinks[tokenHash];
  const headers = makeSession(req, db, user.id);
  writeDb(db);
  res.writeHead(302, {
    ...headers,
    Location: "/?auth=magic#account",
    "Cache-Control": "no-store",
  });
  res.end();
}

async function askGemini(sequence) {
  if (!/^[A-Z]+$/.test(sequence)) return { used: false, words: [], badgeIds: [] };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || typeof fetch !== "function") return { used: false, words: [], badgeIds: [] };

  const cached = geminiCache.get(sequence);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const prompt = `
You are AlphaRNG's server-side roll analyzer.
Sequence: ${sequence}

Return strict JSON only:
{
  "words": ["contiguous English words that appear exactly inside the sequence, length 4-9"],
  "badgeIds": []
}

Rules:
- Words must be contiguous substrings of the sequence.
- Do not invent letters.
- Only return normal English words. If there are no words, return an empty words array.
- Leave badgeIds empty; deterministic server rules award badges.
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    if (typeof timeout.unref === "function") timeout.unref();
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
          maxOutputTokens: 512,
        },
      }),
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`Gemini returned ${response.status}`);
    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "{}";
    const parsed = JSON.parse(text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim());
    const value = {
      used: true,
      words: normalizeAiWords(parsed.words || [], sequence),
      badgeIds: normalizeBadgeIds(parsed.badgeIds || []),
    };
    setGeminiCache(sequence, value);
    return value;
  } catch (error) {
    console.warn("Gemini analysis failed; using deterministic fallback.", error.message);
    const value = { used: false, words: [], badgeIds: [] };
    setGeminiCache(sequence, value, Math.min(GEMINI_CACHE_TTL_MS, 1000 * 60 * 5));
    return value;
  }
}

function setGeminiCache(sequence, value, ttl = GEMINI_CACHE_TTL_MS) {
  geminiCache.set(sequence, {
    value,
    expiresAt: Date.now() + ttl,
  });

  while (geminiCache.size > GEMINI_CACHE_MAX) {
    const oldestKey = geminiCache.keys().next().value;
    geminiCache.delete(oldestKey);
  }
}

async function evaluateSequence(roll, derived, knownBadgeIds) {
  const parts = typeof roll === "string" ? normalizeRollParts({ sequence: roll }) : roll;
  const gemini = await askGemini(parts.letterSequence);
  const words = mergeWordLists(findWords(parts.letterSequence), gemini.words || []);
  const letterCtx = buildRollContext(parts.letterSequence, { ...derived, rollMode: "letters" }, words);
  const numberCtx = buildRollContext(parts.numberSequence, { ...derived, rollMode: "numbers" }, []);
  const alphabetBadges = BADGES.filter((badge) => !isNumberBadge(badge) && isBadgeAvailableForServer(badge, derived) && badge.condition(letterCtx));
  const numberBadges = BADGES.filter((badge) => isNumberBadge(badge) && isBadgeAvailableForServer(badge, derived) && badge.condition(numberCtx));
  const earnedBadges = [...alphabetBadges, ...numberBadges];
  earnedBadges.forEach(ensureBadgeEconomy);
  const badgeGlyphsRaw = alphabetBadges.reduce((sum, badge) => sum + Math.floor(badge.value * getBadgeValueMultiplier(badge, derived, letterCtx)), 0);
  const alphabetBadgeGlyphs = Math.floor(badgeGlyphsRaw * derived.badgeMultiplier);
  const numberMultiplierBonus = numberBadges.reduce((sum, badge) => sum + Number(badge.numberMultiplier || 0), 0) * (derived.numberBadgeMultiplier || 1);
  const numberMultiplier = 1 + numberMultiplierBonus;
  const badgeGlyphsBoosted = Math.floor(alphabetBadgeGlyphs * numberMultiplier);
  const newlyDiscoveredAlphabet = alphabetBadges.filter((badge) => !knownBadgeIds.includes(badge.id));
  const autoClaimBonus = derived.autoClaim ? newlyDiscoveredAlphabet.length * derived.autoClaimBonus : 0;
  const rawGlyphs = BASE_GLYPHS + badgeGlyphsBoosted * derived.luck + autoClaimBonus;
  const glyphsEarned = Math.max(BASE_GLYPHS, Math.floor(rawGlyphs * derived.glyphMultiplier));
  const tier = determineTier(earnedBadges, glyphsEarned);

  return {
    sequence: parts.sequence,
    letterSequence: parts.letterSequence,
    numberSequence: parts.numberSequence,
    glyphsEarned,
    baseGlyphs: BASE_GLYPHS,
    badgeGlyphs: badgeGlyphsRaw,
    alphabetBadgeGlyphs,
    badgeGlyphsBoosted,
    autoClaimBonus,
    numberMultiplier,
    numberMultiplierBonus,
    numberBoostEarned: numberMultiplierBonus,
    rollMode: "combo",
    tier,
    at: Date.now(),
    words,
    earnedBadges: earnedBadges.map((badge) => ({
      id: badge.id,
      name: badge.name,
      description: badge.description,
      rarity: badge.rarity,
      value: isNumberBadge(badge) ? 0 : badge.value,
      numberMultiplier: Number(badge.numberMultiplier || 0),
      icon: badge.icon,
    })),
    geminiUsed: gemini.used,
    geminiBadgeIds: gemini.badgeIds || [],
  };
}

function buildRollContext(sequence, derived, words) {
  const chars = [...sequence];
  const letters = chars.filter(isLetter);
  const numbers = chars.filter((char) => /\d/.test(char));
  const digitValues = numbers.map((char) => Number(char));
  const counts = countCharacters(chars);
  const letterCounts = countCharacters(letters);
  const numberCounts = countCharacters(numbers);
  const values = Object.values(counts);
  const letterPositions = letters.map(getAlphabetPosition);
  const maxCount = values.length ? Math.max(...values) : 0;
  const exactPairCount = values.filter((count) => count === 2).length;
  const alphaScore = letters.reduce((sum, char) => sum + getAlphabetPosition(char), 0);
  const longestWordLength = words.reduce((max, word) => Math.max(max, Number(word.length || word.word?.length || 0)), 0);
  const highCount = letters.filter((char) => getAlphabetPosition(char) >= 14).length;
  const lowCount = letters.filter((char) => getAlphabetPosition(char) <= 13).length;
  const glitchedChance = Math.min(0.03, 0.0015 * derived.luck + (derived.glitchChanceBonus || 0));
  const luckSurgeChance = Math.min(0.1, 0.018 * derived.luck + (derived.luckSurgeBonus || 0));
  const cosmicPulseChance = Math.min(0.006, 0.00035 * derived.luck + (derived.glitchChanceBonus || 0) * 0.04);
  const realityRiftChance = Math.min(0.0015, 0.00006 * derived.luck + (derived.glitchChanceBonus || 0) * 0.012);
  const abyssalJackpotChance = Math.min(0.00035, 0.000012 * derived.luck + (derived.glitchChanceBonus || 0) * 0.003);
  const rollMode = derived.rollMode === "numbers" ? "numbers" : "letters";

  return {
    sequence,
    rollMode,
    isLetterRoll: rollMode === "letters" && letters.length === chars.length,
    isNumberRoll: rollMode === "numbers" && numbers.length === chars.length,
    chars,
    letters,
    numbers,
    digitValues,
    counts,
    letterCounts,
    numberCounts,
    maxCount,
    uniqueCount: new Set(chars).size,
    pairCount: values.filter((count) => count >= 2).length,
    exactPairCount,
    hasPair: values.some((count) => count === 2),
    hasTriple: values.some((count) => count === 3),
    alphaScore,
    highCount,
    lowCount,
    letterCount: letters.length,
    numberCount: numbers.length,
    consonantCount: letters.filter((char) => !VOWELS.has(char)).length,
    hasLetters: letters.length > 0,
    hasNumbers: numbers.length > 0,
    firstChar: chars[0] || "",
    lastChar: chars[chars.length - 1] || "",
    alphabetSpan: letterPositions.length ? Math.max(...letterPositions) - Math.min(...letterPositions) : 0,
    rareLetterCount: letters.filter((char) => "QXZJ".includes(char)).length,
    numberPairCount: Object.values(numberCounts).filter((count) => count >= 2).length,
    digitSum: numbers.reduce((sum, char) => sum + Number(char), 0),
    digitProduct: digitValues.reduce((product, value) => product * value, digitValues.length ? 1 : 0),
    evenDigitCount: digitValues.filter((value) => value % 2 === 0).length,
    oddDigitCount: digitValues.filter((value) => value % 2 === 1).length,
    primeDigitCount: digitValues.filter((value) => [2, 3, 5, 7].includes(value)).length,
    zeroCount: numbers.filter((char) => char === "0").length,
    digitUniqueCount: new Set(numbers).size,
    digitAscendingRun: hasDigitRun(numbers, 3, 1),
    digitDescendingRun: hasDigitRun(numbers, 3, -1),
    digitStraightFour: hasDigitRun(numbers, 4, 1) || hasDigitRun(numbers, 4, -1),
    allEvenDigits: numbers.length > 0 && digitValues.every((value) => value % 2 === 0),
    allOddDigits: numbers.length > 0 && digitValues.every((value) => value % 2 === 1),
    vowelCount: letters.filter((char) => VOWELS.has(char)).length,
    hasAdjacentRepeat: hasAdjacentRepeat(sequence),
    hasAdjacentTriple: hasAdjacentTriple(sequence),
    hasSandwich: hasSandwich(sequence),
    symmetryPairs: countSymmetryPairs(sequence),
    hasVowelRun: hasVowelRun(sequence, 3),
    hasConsonantRun: hasConsonantRun(sequence, 4),
    zigzagAlphabet: isZigzagAlphabet(letters),
    highLowAlternating: isHighLowAlternating(letters),
    words,
    longestWordLength,
    wordCoverage: sequence.length ? longestWordLength / sequence.length : 0,
    fullSequenceWord: /^[A-Z]+$/.test(sequence) && WORD_SET.has(sequence),
    glitchedBonus: Math.random() < glitchedChance,
    luckSurge: Math.random() < luckSurgeChance,
    mythicPulse: Math.random() < (derived.mythicPulseChance || 0),
    cosmicPulse: Math.random() < cosmicPulseChance,
    realityRift: Math.random() < realityRiftChance,
    abyssalJackpot: Math.random() < abyssalJackpotChance,
  };
}

function findWords(sequence) {
  const found = new Map();
  for (let start = 0; start < sequence.length; start += 1) {
    for (let length = 4; length <= Math.min(9, sequence.length - start); length += 1) {
      const piece = sequence.slice(start, start + length);
      if (/^[A-Z]+$/.test(piece) && WORD_SET.has(piece)) {
        found.set(piece, { word: piece, start, length, source: "local" });
      }
    }
  }
  return Array.from(found.values()).sort((a, b) => b.length - a.length || a.start - b.start);
}

function normalizeAiWords(words, sequence) {
  return words
    .map((entry) => {
      const word = String(typeof entry === "string" ? entry : entry.word || "").toUpperCase().replace(/[^A-Z]/g, "");
      if (!word || word.length < 4 || word.length > 9) return null;
      const start = sequence.indexOf(word);
      if (start < 0) return null;
      return { word, start, length: word.length, source: "gemini" };
    })
    .filter(Boolean);
}

function normalizeBadgeIds(ids) {
  const allowed = new Set(BADGES.map((badge) => badge.id));
  return ids.map(String).filter((id) => allowed.has(id));
}

function mergeWordLists(localWords, aiWords) {
  const merged = new Map();
  [...localWords, ...aiWords].forEach((entry) => {
    if (!merged.has(entry.word)) merged.set(entry.word, entry);
  });
  return Array.from(merged.values()).sort((a, b) => b.length - a.length || a.start - b.start);
}

function determineTier(earnedBadges, glyphsEarned) {
  if (earnedBadges.some((badge) => badge.rarity === "glitched")) return "glitched";
  const highestBadgeRank = earnedBadges.reduce((rank, badge) => Math.max(rank, RARITIES[badge.rarity]?.rank || 0), 0);
  const valueTier =
    glyphsEarned >= 2500 ? 6 :
    glyphsEarned >= 1300 ? 5 :
    glyphsEarned >= 650 ? 4 :
    glyphsEarned >= 240 ? 3 :
    glyphsEarned >= 90 ? 2 :
    glyphsEarned >= 40 ? 1 :
    0;
  const rank = Math.max(highestBadgeRank, valueTier);
  return TIER_ORDER[Math.min(rank, TIER_ORDER.length - 2)] || "trash";
}

function sanitizeDerived(derived) {
  return {
    luck: 1,
    badgeMultiplier: 1,
    glyphMultiplier: 1,
    numberBadgeMultiplier: 1,
    alphaBadgeMultiplier: 1,
    autoClaim: false,
    autoClaimBonus: 25,
    mixedMode: true,
    rollMode: derived?.rollMode === "numbers" ? "numbers" : "letters",
    glitchChanceBonus: 0,
    luckSurgeBonus: 0,
    mythicPulseChance: MANUAL_BADGE_DROP_CHANCES.mythic_pulse,
    combo_scanner: false,
    word_lens: false,
    phrase_matrix: false,
    word_dividend: false,
    word_primer: false,
    lexicon_engine: false,
    mirror_array: false,
    mirror_polish: false,
    mirror_chamber: false,
    alphabet_radar: false,
    rare_letter_radar: false,
    alphabet_overclock: false,
    pattern_crown: false,
    pattern_engine: false,
    sequence_expander_3: false,
    sequence_expander_4: false,
    number_attunement: false,
    digit_alchemy: false,
    digit_multiplier_1: false,
    digit_multiplier_2: false,
    checksum_scanner: false,
    prime_resonator: false,
    zero_overdrive: false,
    digit_circuit: false,
    digit_relay: false,
    number_shimmer: false,
    digit_cutscene_core: true,
    mixed_mastery: false,
    mythic_lens: false,
    cutscene_gallery: true,
    epic_projector: true,
    alpha_omega_core: false,
  };
}

function getBadgeValueMultiplier(badge, derived, ctx) {
  let multiplier = 1;
  const id = badge.id || "";

  if (/(word|lexicon|gemini|said|cover|relic|fragment|oracle)/.test(id)) {
    if (derived.word_lens) multiplier += 0.08;
    if (derived.phrase_matrix) multiplier += 0.12;
    if (derived.word_dividend) multiplier += 0.1;
    if (derived.word_primer) multiplier += 0.06;
    if (derived.lexicon_engine) multiplier += 0.09;
  }

  if (/(mirror|palindrome|bookend|symmetry)/.test(id)) {
    if (derived.mirror_array) multiplier += 0.06;
    if (derived.mirror_polish) multiplier += 0.1;
    if (derived.mirror_chamber) multiplier += 0.06;
  }

  if (/(alpha|alphabet|letter|vowel|consonant|q_|x_|zed|royal|spectrum|sum|sigma|prism)/.test(id)) {
    if (derived.alphabet_radar) multiplier += 0.06;
    if (derived.rare_letter_radar) multiplier += 0.08;
    if (derived.alphabet_overclock) multiplier += 0.1;
  }

  if (/(pair|triple|quad|house|stack|tap|sandwich|snake|zigzag|switch|chaos|compact|five|six|dense|step|ladder)/.test(id)) {
    if (derived.combo_scanner) multiplier += 0.05;
    if (derived.pattern_engine) multiplier += 0.1;
    if (derived.pattern_crown) multiplier += 0.08;
    if (derived.sequence_expander_3) multiplier += 0.05;
    if (derived.sequence_expander_4 && /six|dense/.test(id)) multiplier += 0.07;
  }

  if (ctx?.isNumberRoll || badge.rollMode === "numbers" || badge.requiresMixed) {
    if (derived.mixed_mastery) multiplier += 0.08;
  }

  return multiplier;
}

function isNumberBadge(badge) {
  return Boolean(Number(badge?.numberMultiplier || 0) > 0 || badge?.rollMode === "numbers" || badge?.requiresMixed);
}

function isBadgeAvailableForServer(badge, derived) {
  return true;
}

function normalizeSequence(sequence) {
  const clean = String(sequence || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 18);
  if (!clean) throw new Error("Sequence required");
  return clean;
}

function normalizeRollParts(body) {
  const combined = String(body?.sequence || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 18);
  const letterSequence = (String(body?.letterSequence || "").toUpperCase().replace(/[^A-Z]/g, "") ||
    combined.replace(/[^A-Z]/g, "")).slice(0, 12);
  const numberSequence = (String(body?.numberSequence || "").replace(/\D/g, "") ||
    combined.replace(/\D/g, "")).slice(0, 8);
  if (!letterSequence || !numberSequence) throw new Error("Letter and number lanes are required");
  return {
    sequence: `${letterSequence}${numberSequence}`,
    letterSequence,
    numberSequence,
  };
}

function sanitizeLeaderboardRow(body, user) {
  const sequence = normalizeSequence(body.sequence);
  const glyphs = Math.max(0, Math.floor(Number(body.glyphs || body.glyphsEarned) || 0));
  if (!sequence || glyphs <= 0) return null;
  const at = sanitizeTimestamp(body.at) || Date.now();
  return {
    id: String(body.rollId || `${user?.id || "guest"}:${at}:${sequence}:${glyphs}`).slice(0, 160),
    userId: user?.id || null,
    player: cleanDisplayName(user?.displayName || body.player || "Guest"),
    email: user?.email || normalizeEmail(body.email || "local@alpharng"),
    sequence,
    letterSequence: String(body.letterSequence || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8),
    numberSequence: String(body.numberSequence || "").replace(/\D/g, "").slice(0, 8),
    tier: TIER_ORDER.includes(body.tier) ? body.tier : "common",
    glyphs,
    badges: Math.max(0, Math.floor(Number(body.badges || 0) || 0)),
    at,
  };
}

function addLeaderboardRoll(rows, row) {
  const key = row.id || `${row.userId || row.email || row.player}:${row.at}:${row.sequence}`;
  const next = normalizeLeaderboardRolls(rows).filter((item) => (
    item.id || `${item.userId || item.email || item.player}:${item.at}:${item.sequence}`
  ) !== key);
  next.push(row);
  return normalizeLeaderboardRolls(next);
}

function normalizeLeaderboardRolls(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.sequence && Number.isFinite(Number(row.glyphs)))
    .map((row) => ({
      id: String(row.id || `${row.userId || row.email || row.player}:${row.at || Date.now()}:${row.sequence}:${row.glyphs}`).slice(0, 160),
      userId: row.userId || null,
      player: cleanDisplayName(row.player || "Alpha Roller"),
      email: normalizeEmail(row.email || ""),
      sequence: normalizeSequence(row.sequence),
      letterSequence: String(row.letterSequence || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8),
      numberSequence: String(row.numberSequence || "").replace(/\D/g, "").slice(0, 8),
      tier: TIER_ORDER.includes(row.tier) ? row.tier : "common",
      glyphs: Math.max(0, Math.floor(Number(row.glyphs) || 0)),
      badges: Math.max(0, Math.floor(Number(row.badges) || 0)),
      at: sanitizeTimestamp(row.at) || Date.now(),
    }))
    .sort((a, b) => Number(b.at) - Number(a.at))
    .slice(0, 2000);
}

function normalizeLeaderboard(rows) {
  return topRollRows(normalizeLeaderboardRolls(rows), 0, 50);
}

function buildLeaderboardBoards(db) {
  const rolls = normalizeLeaderboardRolls(db.leaderboard || []);
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;

  return {
    daily: publicLeaderboardRows(topRollRows(rolls, now - dayMs, 50), "glyphs"),
    weekly: publicLeaderboardRows(topRollRows(rolls, now - weekMs, 50), "glyphs"),
    allTime: publicLeaderboardRows(topRollRows(rolls, 0, 50), "glyphs"),
    topGlyphs: publicLeaderboardRows(topPlayerRows(db, "glyphs"), "totalGlyphs"),
    topRolls: publicLeaderboardRows(topPlayerRows(db, "rolls"), "totalRolls"),
  };
}

function topRollRows(rows, since, limit) {
  return normalizeLeaderboardRolls(rows)
    .filter((row) => Number(row.at) >= since)
    .sort((a, b) => Number(b.glyphs) - Number(a.glyphs) || Number(b.at) - Number(a.at))
    .slice(0, limit);
}

function topPlayerRows(db, mode) {
  const users = Object.values(db.users || {});
  return users
    .map((user) => {
      const progress = sanitizePlayerProgress(user.progress || null);
      const bestRoll = sanitizeRollSummary(user.bestRoll || progress?.bestRoll || null);
      return {
        userId: user.id,
        player: cleanDisplayName(user.displayName || "Alpha Roller"),
        email: normalizeEmail(user.email || ""),
        sequence: bestRoll?.sequence || "—",
        letterSequence: bestRoll?.letterSequence || "",
        numberSequence: bestRoll?.numberSequence || "",
        tier: TIER_ORDER.includes(bestRoll?.tier) ? bestRoll.tier : "common",
        glyphs: Math.max(0, Math.floor(Number(user.totalGlyphs || progress?.totalGlyphs) || 0)),
        totalGlyphs: Math.max(0, Math.floor(Number(user.totalGlyphs || progress?.totalGlyphs) || 0)),
        totalRolls: Math.max(0, Math.floor(Number(user.totalRolls || progress?.totalRolls) || 0)),
        badges: bestRoll?.badgeCount || 0,
        at: bestRoll?.at || user.createdAt || Date.now(),
      };
    })
    .filter((row) => mode === "rolls" ? row.totalRolls > 0 : row.totalGlyphs > 0)
    .sort((a, b) => {
      const field = mode === "rolls" ? "totalRolls" : "totalGlyphs";
      return Number(b[field]) - Number(a[field]) || Number(b.glyphs) - Number(a.glyphs);
    })
    .slice(0, 50);
}

function publicLeaderboardRows(rows, metric = "glyphs") {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    player: cleanDisplayName(row.player || "Alpha Roller"),
    sequence: row.sequence,
    letterSequence: row.letterSequence || "",
    numberSequence: row.numberSequence || "",
    tier: TIER_ORDER.includes(row.tier) ? row.tier : "common",
    glyphs: Math.max(0, Math.floor(Number(row.glyphs) || 0)),
    totalGlyphs: Math.max(0, Math.floor(Number(row.totalGlyphs || row.glyphs) || 0)),
    totalRolls: Math.max(0, Math.floor(Number(row.totalRolls) || 0)),
    badges: Math.max(0, Math.floor(Number(row.badges) || 0)),
    at: Number(row.at) || Date.now(),
    metric,
  }));
}

function hasEmailTransport() {
  return Boolean(
    (process.env.RESEND_API_KEY && process.env.TWO_FACTOR_FROM_EMAIL) ||
    (process.env.SMTP_USER && process.env.SMTP_PASS)
  );
}

function serveStatic(req, res, pathname) {
  let safePath;
  try {
    safePath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", ...securityHeaders() });
    res.end("Bad request");
    return;
  }

  if (!PUBLIC_FILES.has(safePath)) {
    res.writeHead(pathname === "/favicon.ico" ? 204 : 404, {
      "Content-Type": "text/plain; charset=utf-8",
      ...securityHeaders(),
    });
    res.end(pathname === "/favicon.ico" ? "" : "Not found");
    return;
  }

  const filePath = path.normalize(path.join(ROOT, safePath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, securityHeaders());
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (pathname === "/favicon.ico") {
        res.writeHead(204, securityHeaders());
        res.end();
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...securityHeaders() });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=300",
      ...securityHeaders(),
    });
    res.end(content);
  });
}

function countCharacters(chars) {
  return chars.reduce((counts, char) => {
    counts[char] = (counts[char] || 0) + 1;
    return counts;
  }, {});
}

function hasAlphabetRun(sequence, length, direction) {
  for (let start = 0; start <= sequence.length - length; start += 1) {
    const piece = sequence.slice(start, start + length);
    if (!/^[A-Z]+$/.test(piece)) continue;
    let match = true;
    for (let index = 1; index < piece.length; index += 1) {
      if (getAlphabetPosition(piece[index]) - getAlphabetPosition(piece[index - 1]) !== direction) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

function hasDigitRun(numbers, length, direction) {
  if (numbers.length < length) return false;
  for (let start = 0; start <= numbers.length - length; start += 1) {
    let match = true;
    for (let index = 1; index < length; index += 1) {
      if (Number(numbers[start + index]) - Number(numbers[start + index - 1]) !== direction) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

function hasAdjacentRepeat(sequence) {
  return /(.)\1/.test(sequence);
}

function hasAdjacentTriple(sequence) {
  return /(.)\1\1/.test(sequence);
}

function hasSandwich(sequence) {
  for (let index = 0; index < sequence.length - 2; index += 1) {
    if (sequence[index] === sequence[index + 2]) return true;
  }
  return false;
}

function countSymmetryPairs(sequence) {
  let pairs = 0;
  for (let index = 0; index < Math.floor(sequence.length / 2); index += 1) {
    if (sequence[index] === sequence[sequence.length - 1 - index]) pairs += 1;
  }
  return pairs;
}

function hasVowelRun(sequence, length) {
  let run = 0;
  for (const char of sequence) {
    run = VOWELS.has(char) ? run + 1 : 0;
    if (run >= length) return true;
  }
  return false;
}

function hasConsonantRun(sequence, length) {
  let run = 0;
  for (const char of sequence) {
    run = /^[A-Z]$/.test(char) && !VOWELS.has(char) ? run + 1 : 0;
    if (run >= length) return true;
  }
  return false;
}

function isZigzagAlphabet(letters) {
  if (letters.length < 5) return false;
  const values = letters.map(getAlphabetPosition);
  let previousDirection = 0;
  for (let index = 1; index < values.length; index += 1) {
    const direction = Math.sign(values[index] - values[index - 1]);
    if (!direction || direction === previousDirection) return false;
    previousDirection = direction;
  }
  return true;
}

function isHighLowAlternating(letters) {
  if (letters.length < 5) return false;
  const zones = letters.map((char) => getAlphabetPosition(char) >= 14);
  return zones.every((zone, index) => index === 0 || zone !== zones[index - 1]);
}

function isPrime(value) {
  const number = Math.floor(Number(value) || 0);
  if (number < 2) return false;
  for (let divisor = 2; divisor <= Math.sqrt(number); divisor += 1) {
    if (number % divisor === 0) return false;
  }
  return true;
}

function isAlternatingVowelConsonant(sequence) {
  if (sequence.length < 4 || !/^[A-Z]+$/.test(sequence)) return false;
  const pattern = [...sequence].map((char) => VOWELS.has(char));
  return pattern.every((isVowel, index) => index === 0 || isVowel !== pattern[index - 1]);
}

function getAlphabetPosition(char) {
  return char.charCodeAt(0) - 64;
}

function isLetter(char) {
  return /^[A-Z]$/.test(char);
}

function reverseString(value) {
  return [...value].reverse().join("");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname === "/auth/magic") {
    handleMagicLink(req, res, url);
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url.pathname);
    return;
  }
  serveStatic(req, res, url.pathname);
});

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const index = trimmed.indexOf("=");
    if (index === -1) return;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] == null) process.env[key] = value;
  });
}

ensureDb();
server.listen(PORT, HOST, () => {
  console.log(`AlphaRNG live server running at http://${HOST}:${PORT}/`);
  console.log(`Gemini: ${process.env.GEMINI_API_KEY ? "configured" : "not configured (local fallback active)"}`);
});
