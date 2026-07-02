/* AlphaRNG
   A browser game about rolling letter sequences, spotting patterns, collecting
   badges, and optionally connecting to a secure backend for global accounts,
   leaderboards, and Gemini-powered word checks. The static build works offline
   with localStorage and a local lexicon fallback.
*/

(() => {
  "use strict";

  const SAVE_KEY = "alpharng_save_v4";
  const BACKEND_CONFIG_KEY = "alpharng_backend_url_v1";
  const DEFAULT_API_BASE = location.protocol.startsWith("http") ? "/api" : "";
  const ADMIN_EMAILS = new Set(["206713@gardenschool.edu.my"]);
  const PREFERS_REDUCED_MOTION = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MOBILE_VIEWPORT = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 720px)").matches;
  const LOW_POWER_MODE = Boolean(
    PREFERS_REDUCED_MOTION ||
    MOBILE_VIEWPORT ||
    (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
  );
  const BADGE_FEED_LIMIT = LOW_POWER_MODE ? 10 : 18;
  const BASE_GLYPHS = 25;
  const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const NUMBERS = "0123456789";
  const VOWELS = new Set(["A", "E", "I", "O", "U"]);
  const TIER_ORDER = ["trash", "common", "uncommon", "rare", "epic", "legendary", "mythic", "glitched"];

  const RARITIES = {
    common: { label: "Common", rank: 1, color: "#607086", soft: "#edf3f8" },
    uncommon: { label: "Uncommon", rank: 2, color: "#07885b", soft: "#e6faf2" },
    rare: { label: "Rare", rank: 3, color: "#0664d9", soft: "#e5f1ff" },
    epic: { label: "Epic", rank: 4, color: "#7740db", soft: "#f0e9ff" },
    legendary: { label: "Legendary", rank: 5, color: "#b96d00", soft: "#fff2d5" },
    mythic: { label: "Mythic", rank: 6, color: "#d92f6b", soft: "#ffe8f0" },
    glitched: { label: "Glitched", rank: 7, color: "#087e75", soft: "#e2fff5" },
  };

  // Badge rarity/value is generated from estimated drop chance.
  // Lower chance => higher rarity and more Glyphs.
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

  const TIER_LABELS = {
    trash: "Trash",
    common: "Common",
    uncommon: "Uncommon",
    rare: "Rare",
    epic: "Epic",
    legendary: "Legendary",
    mythic: "Mythic",
    glitched: "Glitched",
  };

  const CUTSCENE_STYLES = [
    { id: "alphabet", name: "Alphabet Rift", icon: "AZ", color: "#0b6cff", copy: "Letters lock into a clean blue signal gate." },
    { id: "digit", name: "Digit Reactor", icon: "67", color: "#16c784", copy: "Numbers ignite a multiplier reactor under the badge." },
    { id: "word", name: "Lexicon Gate", icon: "Aa", color: "#6757ff", copy: "Detected words open a deep blue language portal." },
    { id: "mirror", name: "Mirror Vault", icon: "⇄", color: "#10a7c7", copy: "Symmetric patterns reflect into a glassy reveal chamber." },
    { id: "pattern", name: "Pattern Engine", icon: "◇", color: "#f59e0b", copy: "Repeats, stacks, and shapes fire like arcade machinery." },
    { id: "royal", name: "Royal Prism", icon: "KQ", color: "#d97706", copy: "Rare letters and crown-like finds get gold prism treatment." },
    { id: "mythic", name: "Mythic Bloom", icon: "✦", color: "#d92f6b", copy: "Mythic badge signals blossom into a pink celestial reveal." },
    { id: "glitch", name: "Glitch Break", icon: "GX", color: "#08b6a2", copy: "Corrupted badge signals tear through static before stabilizing." },
  ];

  const DEMO_LEADERBOARD = [
    { player: "NovaCipher", email: "demo@alpharng.local", sequence: "GLYPHS", tier: "legendary", glyphs: 1725, badges: 5, at: Date.now() - 7200000 },
    { player: "ByteBloom", email: "demo@alpharng.local", sequence: "ALPHAZ", tier: "epic", glyphs: 940, badges: 4, at: Date.now() - 9900000 },
    { player: "VowelMage", email: "demo@alpharng.local", sequence: "AEIOUX", tier: "rare", glyphs: 510, badges: 3, at: Date.now() - 15600000 },
    { player: "SignalFox", email: "demo@alpharng.local", sequence: "QWERTY", tier: "uncommon", glyphs: 210, badges: 2, at: Date.now() - 28400000 },
    { player: "GlyphKid", email: "demo@alpharng.local", sequence: "MATRIX", tier: "uncommon", glyphs: 185, badges: 2, at: Date.now() - 36000000 },
  ];

  // Local dictionary for word badges. This intentionally stays small and fast:
  // no AI calls, no backend, no API key, and no data leaves the browser.
  const LOCAL_WORDS = `
    ACE ACT ADD AGE AID AIM AIR ALE ALL ANT APE ARC ARE ARM ART ASH ASK ATE
    BAD BAG BAN BAR BAT BAY BED BEE BET BID BIG BIN BIT BOB BOG BOX BOY BUD BUG BUS BUY
    CAB CAD CAN CAP CAR CAT COD COG CON COP COT COW CRY CUB CUP CUT
    DAD DAY DEN DEW DID DIE DIG DIM DOG DOT DRY DUE DUG
    EAR EAT EEL EGG ELF END ERA EVE EYE
    FAN FAR FAT FED FEE FEN FEW FIG FIN FIT FIX FLY FOG FOX FUN FUR
    GAP GAS GEM GET GIG GIN GOD GOT GUM GUN GUT GUY
    HAD HAM HAT HAY HEN HER HID HIM HIP HIT HOP HOT HOW HUG HUM HUT
    ICE ION IVY
    JAM JAR JAW JET JIG JOB JOG JOY JUG
    KEY KID KIN KIT
    LAB LAD LAG LAP LAW LAY LED LEG LET LID LIE LOG LOT LOW
    MAD MAN MAP MAT MAY MEN MET MID MIX MOB MOM MOP MUD
    NAP NET NEW NIB NOD NOR NOT NOW NUT
    OAK OAR ODD OFF OIL OLD ONE ORB ORE OWL OWN
    PAD PAL PAN PAT PAY PEA PEN PET PIE PIG PIN PIT POD POP POT PRO PUP PUT
    RAG RAM RAN RAP RAT RAY RED RIB RID RIG RIP ROB ROD ROT ROW RUB RUN RYE
    SAD SAG SAP SAT SAW SAY SEA SEE SET SHY SIN SIP SIT SKY SLY SOD SON SOW SOY SUN
    TAB TAG TAN TAP TAR TAX TEA TEN THE TIE TIN TIP TOE TON TOP TOY TRY TUB TUG TWO
    USE
    VAN VAT VET VOW
    WAR WAS WAY WEB WED WET WHO WHY WIN WIT WON WOW
    YAK YAM YAP YAW YES YET YOU
    ZAP ZIP ZOO

    ABLE ACID ACRE AGED APEX AREA ARIA ATOM AURA
    BABY BACK BAKE BALD BALL BAND BARK BEAD BEAM BEAR BEAT BELL BEND BIRD BITE BLUE BOAT BOLD BOLT BOND BONE BOOK BOOM BORN BRAG BRIM BUBB BURN
    CAFE CAKE CALM CAMP CARD CARE CART CASE CASH CAST CAVE CHAT CHIP COLD CORE COVE CROW CUBE CURE
    DARE DARK DATA DAWN DICE DIVE DOME DOOR DOVE DRIP DROP DUAL DUNE DUSK
    EARN EASE EAST ECHO EDGE EGGY ELMO EVEN EVER
    FACE FACT FADE FAIR FALL FARM FAST FATE FERN FIRE FISH FIVE FLAG FLAK FLIP FLOW FOLD FONT FOOD FORK FORM FOUR FROG
    GAIN GAME GATE GEAR GIFT GLOW GOAL GOLD GOOD GRID GROW
    HALF HALL HAND HARD HARM HAZE HEAL HEAR HEAT HERO HILL HINT HIVE HOLD HOME HOPE HORN HUSH
    IDEA IDLE IRON ITEM
    JADE JAZZ JUMP JUNE
    KIND KING KITE KNEW KNOW
    LACE LADY LAKE LAMB LAMP LAND LANE LARK LATE LEAF LEAP LEFT LEND LENS LIFE LIFT LIME LINE LINK LION LIST LIVE LOAD LOAF LOCK LOOP LOVE LUCK LUNA
    MADE MAGE MAIL MAIN MAKE MANY MARK MARS MATH MAZE MEAL MEAN MINT MIST MODE MOON MORE MOVE
    NAME NEAR NEAT NERD NEST NICE NINE NODE NOON NOTE NOVA
    OATH OCEAN ODDS OPEN ORCA OVAL
    PACE PACK PAGE PAIR PARK PART PATH PEAK PEAR PILE PINE PING PLAN PLAY PLOT PLUS POEM POND PORT PURE
    RACE RAIN RANK RARE READ REAL REEF RIFT RING RISK ROAD ROCK ROLL ROPE ROSE RUNE RUSH
    SAGE SAND SAVE SCAN SEAL SEED SEEK SHIP SIGN SING SINK SITE SNAP SNOW SOAR SOFT SOLO SONG SOUL SPAN STAR STEM STEP STIR STONE
    TAIL TAKE TALK TALL TEAM TIDE TILE TIME TINY TONE TREE TRIO TRUE TUNE TURN
    UNIT USER
    VALE VAST VIBE VINE VOID VOLT
    WAKE WALK WALL WAND WARM WAVE WILD WIND WING WIRE WISH WORD WORN
    YEAR YELL YOGA
    ZONE

    ABOUT ABOVE ACTOR ACUTE ADAPT AFFIX AFTER AGILE ALARM ALBUM ALERT ALIVE ALPHA AMBER AMONG ANGLE APPLE APPLY ARBOR ARENA ARISE AROMA ARROW
    BADGE BASIC BEACH BEACON BEARD BEAST BEGIN BERRY BIRTH BLACK BLADE BLEND BLOCK BLOOM BONUS BRAIN BRAVE BRICK BRING BROAD BROWN BURST
    CABLE CANDY CANON CATCH CHAIN CHARM CHECK CHEST CHIME CLOUD COAST CODEX COLOR COMBO COUNT CRAFT CRANE CRISP CROWN CURVE
    DAILY DELTA DEPTH DIGIT DODGE DRAFT DREAM DRIFT DRIVE DROID
    EAGLE EARTH ELITE EMPTY ENJOY ENTER EPOCH EQUAL EVENT EXTRA
    FAITH FANCY FIELD FINAL FLAME FLASH FOCUS FORGE FOUND FRAME FRESH FROST FRUIT
    GIANT GLIDE GLINT GLORY GLYPH GRACE GRADE GRAND GRANT GREEN GROUP GUARD GUESS
    HEART HONEY HONOR HORSE HOUSE HUMAN HYPER
    IMAGE INDEX INPUT IVORY
    JELLY JOINT JUDGE JUICE
    KARMA KNIFE KNOCK
    LASER LATCH LAYER LEARN LEVEL LIGHT LIMIT LOCAL LOGIC LUCKY LUNAR
    MAGIC MATCH MAYBE METAL MIGHT MINOR MIXED MODEL MONEY MOTOR MOUNT MUSIC MYTHIC
    NERVE NEVER NIGHT NOBLE NORTH NOVEL
    OASIS OCEAN OFFER OMEGA ORBIT ORDER OTHER
    PANEL PARTY PATIO PEACE PEARL PIXEL PLAIN PLANE PLANT POINT POWER PRIME PRISM PROUD PULSE
    QUICK QUIET QUOTA
    RADIO RANGE REACH READY REALM REACT REIGN RIVER ROBOT ROYAL
    SCALE SCORE SCOUT SEEDY SEVEN SHADE SHARE SHARP SHIFT SHINE SIGHT SIGNAL SKILL SMART SNAKE SOLAR SOUND SPARK SPELL SPIRE STACK STAGE STORM STYLE SUGAR
    TABLE TANGO TASTE THREE TIGER TIMER TOAST TOKEN TRACE TRACK TRAIL TRAIN TREND TRICK TRUTH
    ULTRA UNION UPGRADE
    VALUE VAULT VECTOR VIDEO VITAL VIVID
    WATER WHEEL WHITE WINGS WITCH WORLD WORTH
    YOUNG
    ZEBRA ZESTY

    ALPHAS ANCHOR ANIMAL ARCANE BADGES BANNER BEACON BINARY BOTTLE BRANCH BRIGHT BUTTON CANDLE CASTLE CHARGE CIRCLE CODING COSMIC CRYSTAL DRAGON ENERGY ENTROPY FACTOR FILTER FLOWER FUTURE GALAXY GLITCH GOLDEN HAMMER HUNTER ISLAND JUNGLE KNIGHT LETTER LIGHTS LITTLE MATRIX MEMORY MIRROR MYSTIC NUMBER ORACLE ORANGE PALACE PATTERN PHRASE PLANET PLAYER POCKET RANDOM REWARD RHYTHM ROCKET ROLLER SCANNER SECRET SHADOW SIGNAL SILVER SIMPLE SINGAL SPHERE SPIRIT SPRING STREAM STRIKE SUMMER SWITCH SYMBOL SYSTEM TEMPLE THEORY THRIVE THUNDER TICKET TIMBER VECTOR VIOLET WINNER WIZARD WONDER

    ABILITY ADVANCE ALPHARNG AMAZING ANCIENT BALANCE BETWEEN BOOSTER CHANNEL CONTROL CRYSTAL DIGITAL DISCOVER ELEMENT EMERALD FORTUNE FORWARD FREEDOM GENUINE GLYPHIC HARMONY IMAGINE JOURNEY KEYNOTE LEGEND LEXICON MACHINE MYSTERY NATURAL NETWORK ORBITAL PATTERN PERFECT PHOENIX PREMIUM PRIVATE PROCESS PROJECT QUANTUM RAINBOW ROLLING SEQUENCE SPECIAL STRANGE SUNRISE UPGRADE VICTORY WEATHER
  `;

  const WORD_SET = new Set(
    LOCAL_WORDS.split(/\s+/)
      .map((word) => word.trim().toUpperCase())
      .filter((word) => /^[A-Z]{4,9}$/.test(word))
  );

  const UPGRADE_SECTIONS = [
    { id: "core", title: "Core Luck", subtitle: "Glyph gain, Luck, and collection rewards.", defaultOpen: true },
    { id: "scanner", title: "Scanner Lab", subtitle: "Boost word, mirror, alphabet, and pattern rewards.", defaultOpen: true },
    { id: "numbers", title: "Digit Multiplier Lane", subtitle: "Digits roll beside letters and multiply alphabet badge Glyphs.", defaultOpen: true },
    { id: "temporal", title: "Temporal Forge", subtitle: "Cooldowns, sequence length, glow, and roll feel.", defaultOpen: true },
    { id: "endgame", title: "Endgame Relics", subtitle: "Prestige-grade effects and flashy rare-roll systems.", defaultOpen: false },
  ];

  const UPGRADES = [
    {
      id: "better_luck_1",
      name: "Better Luck I",
      icon: "\u2726",
      cost: 350,
      row: 1,
      col: 1,
      effect: "+0.05 Luck",
      description: "Small signal tuning. Future rolls get a little more generous.",
      deps: [],
    },
    {
      id: "shorter_cooldown_1",
      name: "Shorter Cooldown I",
      icon: "\u25f4",
      cost: 600,
      row: 1,
      col: 4,
      effect: "25 min cooldown",
      description: "The chamber recharges faster between rolls.",
      deps: [],
    },
    {
      id: "better_luck_2",
      name: "Better Luck II",
      icon: "\u2737",
      cost: 1000,
      row: 2,
      col: 1,
      effect: "+0.10 Luck",
      description: "Stronger luck improves badge rewards and bonus chances.",
      deps: ["better_luck_1"],
    },
    {
      id: "bigger_sequence",
      name: "Bigger Sequence",
      icon: "5",
      cost: 900,
      row: 2,
      col: 2,
      effect: "5 letters",
      description: "Adds the first extra alphabet die. Word hunting starts at 4 letters, then grows from here.",
      deps: ["better_luck_1"],
    },
    {
      id: "badge_hunter",
      name: "Badge Hunter",
      icon: "\u2605",
      cost: 1200,
      row: 2,
      col: 3,
      effect: "+10% badge Glyphs",
      description: "Badge rewards are worth more before Luck is applied.",
      deps: ["better_luck_1"],
    },
    {
      id: "shorter_cooldown_2",
      name: "Shorter Cooldown II",
      icon: "\u23f1",
      cost: 1800,
      row: 2,
      col: 4,
      effect: "20 min cooldown",
      description: "The roll timer drops even further.",
      deps: ["shorter_cooldown_1"],
    },
    {
      id: "combo_scanner",
      name: "Combo Scanner",
      icon: "\u2318",
      cost: 2200,
      row: 3,
      col: 2,
      effect: "+5% pattern value",
      description: "Improves pattern-reading rewards. Badges are always discoverable.",
      deps: ["badge_hunter"],
    },
    {
      id: "mixed_mode",
      name: "Digit Link",
      icon: "#",
      cost: 900,
      row: 3,
      col: 3,
      effect: "+5% digit boosts",
      description: "Numbers already roll with letters. This tunes digit badges so their same-roll multipliers hit harder.",
      deps: ["combo_scanner"],
    },
    {
      id: "auto_claim",
      name: "Auto Claim",
      icon: "\u2713",
      cost: 2600,
      row: 4,
      col: 2,
      effect: "+25 new badge bonus",
      description: "Auto-records new discoveries and adds a small Glyph bonus.",
      deps: ["combo_scanner"],
    },
    {
      id: "prestige_core",
      name: "Prestige Core",
      icon: "\u25c8",
      cost: 5000,
      row: 4,
      col: 4,
      effect: "Endgame core",
      description: "Requires 10,000 lifetime Glyphs. Adds a final luck spark.",
      deps: ["better_luck_2", "shorter_cooldown_2", "mixed_mode", "auto_claim"],
      lifetimeRequired: 10000,
      prestige: true,
    },
  ];

  UPGRADES.push(
    {
      id: "better_luck_3",
      name: "Better Luck III",
      icon: "L3",
      cost: 2600,
      row: 3,
      col: 1,
      section: "core",
      effect: "+0.15 Luck",
      description: "A deeper tuning layer for rare rewards and bonus sparks.",
      deps: ["better_luck_2"],
    },
    {
      id: "better_luck_4",
      name: "Better Luck IV",
      icon: "L4",
      cost: 5200,
      row: 4,
      col: 1,
      section: "core",
      effect: "+0.20 Luck",
      description: "Push the chamber into high-signal probability bands.",
      deps: ["better_luck_3"],
    },
    {
      id: "badge_hunter_2",
      name: "Badge Hunter II",
      icon: "B2",
      cost: 2800,
      row: 3,
      col: 2,
      section: "core",
      effect: "+15% badge Glyphs",
      description: "Badge values are amplified again before Luck is applied.",
      deps: ["badge_hunter"],
    },
    {
      id: "glyph_amplifier",
      name: "Glyph Amplifier",
      icon: "GA",
      cost: 6000,
      row: 4,
      col: 2,
      section: "core",
      effect: "+12% final Glyphs",
      description: "A final-output amplifier for every successful roll.",
      deps: ["badge_hunter_2"],
    },
    {
      id: "discovery_surge",
      name: "Discovery Surge",
      icon: "DS",
      cost: 4200,
      row: 4,
      col: 3,
      section: "core",
      effect: "+60 new badge bonus",
      description: "New badge discoveries pop harder when Auto Claim is active.",
      deps: ["auto_claim"],
    },
    {
      id: "fortune_resonator",
      name: "Fortune Resonator",
      icon: "FR",
      cost: 13000,
      row: 5,
      col: 2,
      section: "core",
      effect: "+0.25 Luck",
      description: "A late-game Luck engine that hums under every tile.",
      deps: ["better_luck_4", "prestige_core"],
    },
    {
      id: "word_lens",
      name: "Word Lens",
      icon: "WL",
      cost: 2800,
      row: 1,
      col: 1,
      section: "scanner",
      effect: "+8% word value",
      description: "Makes word-based badge rewards hit harder. It does not gate word badges.",
      deps: ["combo_scanner"],
    },
    {
      id: "phrase_matrix",
      name: "Phrase Matrix",
      icon: "PM",
      cost: 5600,
      row: 2,
      col: 1,
      section: "scanner",
      effect: "+12% word value",
      description: "Amplifies huge word finds and Gemini-confirmed word rewards.",
      deps: ["word_lens"],
    },
    {
      id: "mirror_array",
      name: "Mirror Array",
      icon: "MR",
      cost: 2600,
      row: 1,
      col: 2,
      section: "scanner",
      effect: "+6% mirror value",
      description: "Strengthens symmetry, bookend, and folded-shape rewards.",
      deps: ["combo_scanner"],
    },
    {
      id: "alphabet_radar",
      name: "Alphabet Radar",
      icon: "AR",
      cost: 2400,
      row: 1,
      col: 3,
      section: "scanner",
      effect: "+6% alphabet value",
      description: "Boosts span, zigzag, edge, and alphabet-score badge rewards.",
      deps: ["combo_scanner"],
    },
    {
      id: "rare_letter_radar",
      name: "Rare Letter Radar",
      icon: "QZ",
      cost: 2100,
      row: 2,
      col: 3,
      section: "scanner",
      effect: "+10% rare-letter value",
      description: "Boosts Q, X, Z, J, and other crunchy-letter discoveries.",
      deps: ["alphabet_radar"],
    },
    {
      id: "pattern_engine",
      name: "Pattern Engine",
      icon: "PE",
      cost: 4600,
      row: 2,
      col: 2,
      section: "scanner",
      effect: "+10% shape value",
      description: "Improves full-house, sandwich, stack, and rhythm rewards.",
      deps: ["mirror_array", "alphabet_radar"],
    },
    {
      id: "number_attunement",
      name: "Digit Attunement",
      icon: "N1",
      cost: 3400,
      row: 1,
      col: 4,
      section: "scanner",
      effect: "+8% number boosts",
      description: "Digit badge multipliers become stronger.",
      deps: ["mixed_mode"],
    },
    {
      id: "digit_alchemy",
      name: "Digit Alchemy",
      icon: "N2",
      cost: 6500,
      row: 2,
      col: 4,
      section: "scanner",
      effect: "+12% number boosts",
      description: "Same-roll digit multipliers grow again.",
      deps: ["number_attunement"],
    },
    {
      id: "shorter_cooldown_3",
      name: "Shorter Cooldown III",
      icon: "15",
      cost: 4200,
      row: 1,
      col: 1,
      section: "temporal",
      effect: "15 min cooldown",
      description: "The chamber recharges at arcade speed.",
      deps: ["shorter_cooldown_2"],
    },
    {
      id: "shorter_cooldown_4",
      name: "Shorter Cooldown IV",
      icon: "10",
      cost: 9000,
      row: 2,
      col: 1,
      section: "temporal",
      effect: "10 min cooldown",
      description: "A serious cooldown cut for active players.",
      deps: ["shorter_cooldown_3"],
    },
    {
      id: "chrono_core",
      name: "Chrono Core",
      icon: "5m",
      cost: 16000,
      row: 3,
      col: 1,
      section: "temporal",
      effect: "5 min cooldown",
      description: "A prestige-grade recharge core. Still no gambling, just faster play.",
      deps: ["shorter_cooldown_4", "prestige_core"],
    },
    {
      id: "sequence_expander_2",
      name: "Bigger Sequence II",
      icon: "6",
      cost: 3200,
      row: 1,
      col: 2,
      section: "temporal",
      effect: "6 letters",
      description: "Six alphabet dice unlock stronger word coverage and bigger pattern chains.",
      deps: ["bigger_sequence"],
    },
    {
      id: "colossal_sequence",
      name: "Dense Sequence",
      icon: "DS",
      cost: 12000,
      row: 2,
      col: 2,
      section: "temporal",
      effect: "+8% pattern payouts",
      description: "Keeps the alphabet lane capped at 6 letters, but makes max-length patterns pay harder.",
      deps: ["sequence_expander_2", "prestige_core"],
    },
    {
      id: "lucky_reveal",
      name: "Lucky Reveal",
      icon: "LR",
      cost: 2500,
      row: 1,
      col: 3,
      section: "temporal",
      effect: "More glowing letters",
      description: "Luck-touched tiles glow more often.",
      deps: ["better_luck_2"],
    },
    {
      id: "shimmer_coils",
      name: "Shimmer Coils",
      icon: "SC",
      cost: 4800,
      row: 2,
      col: 3,
      section: "temporal",
      effect: "Extra roll shimmer",
      description: "Adds more visual sparkle to rare-feeling rolls.",
      deps: ["lucky_reveal"],
    },
    {
      id: "cutscene_director",
      name: "Cutscene Director",
      icon: "FX",
      cost: 3000,
      row: 1,
      col: 4,
      section: "temporal",
      effect: "Cutscene polish",
      description: "Adds stronger camera, glow, and variant styling. Cutscenes are never locked.",
      deps: ["combo_scanner"],
    },
    {
      id: "mythic_lens",
      name: "Mythic Lens",
      icon: "ML",
      cost: 15000,
      row: 1,
      col: 1,
      section: "endgame",
      effect: "Mythic pulse",
      description: "Adds a tiny chance for mythic bonus resonance.",
      deps: ["prestige_core"],
    },
    {
      id: "glitch_conductor",
      name: "Glitch Conductor",
      icon: "GC",
      cost: 22000,
      row: 2,
      col: 1,
      section: "endgame",
      effect: "More Glitched odds",
      description: "Carefully raises the Glitched Roll signal ceiling.",
      deps: ["mythic_lens"],
    },
    {
      id: "mixed_mastery",
      name: "Dual Mastery",
      icon: "M+",
      cost: 8000,
      row: 1,
      col: 2,
      section: "endgame",
      effect: "+8% digit boosts",
      description: "Late-game tuning for digit multipliers on alphabet badge Glyphs.",
      deps: ["mixed_mode", "number_attunement"],
    },
    {
      id: "celestial_archive",
      name: "Celestial Archive",
      icon: "CA",
      cost: 28000,
      row: 2,
      col: 2,
      section: "endgame",
      effect: "+20% badge Glyphs",
      description: "A luminous archive that rewards huge discoveries.",
      deps: ["phrase_matrix", "glitch_conductor"],
    },
    {
      id: "alpha_omega_core",
      name: "Alpha-Omega Core",
      icon: "AO",
      cost: 50000,
      row: 3,
      col: 2,
      section: "endgame",
      effect: "Final forge core",
      description: "The giant final node: Luck, Glyphs, and maximum flex.",
      deps: ["celestial_archive", "chrono_core", "colossal_sequence"],
      lifetimeRequired: 50000,
      prestige: true,
    }
  );

  UPGRADES.push(
    {
      id: "word_dividend",
      name: "Word Dividend",
      icon: "WD",
      cost: 7200,
      section: "scanner",
      row: 4,
      col: 1,
      effect: "+10% word payouts",
      description: "Word badges pay extra Glyphs. Word badges can still appear without it.",
      deps: ["phrase_matrix"],
    },
    {
      id: "mirror_polish",
      name: "Mirror Polish",
      icon: "MP",
      cost: 6800,
      section: "scanner",
      row: 4,
      col: 2,
      effect: "+10% mirror payouts",
      description: "Symmetry rewards get brighter and more valuable.",
      deps: ["pattern_engine"],
    },
    {
      id: "alphabet_overclock",
      name: "Alphabet Overclock",
      icon: "AO",
      cost: 7000,
      section: "scanner",
      row: 4,
      col: 3,
      effect: "+10% alphabet payouts",
      description: "Alphabet-score, span, and rare-letter rewards gain extra force.",
      deps: ["rare_letter_radar", "pattern_engine"],
    },
    {
      id: "number_sequence_1",
      name: "Extra Digit I",
      icon: "3#",
      cost: 4200,
      section: "numbers",
      row: 2,
      col: 1,
      effect: "3 digits",
      description: "The digit lane gains one extra multiplier die.",
      deps: ["mixed_mode"],
    },
    {
      id: "number_sequence_2",
      name: "Extra Digit II",
      icon: "4#",
      cost: 8500,
      section: "numbers",
      row: 3,
      col: 1,
      effect: "4 digits",
      description: "Four digit dice make stronger same-roll multiplier patterns possible.",
      deps: ["number_sequence_1"],
    },
    {
      id: "number_sequence_3",
      name: "Extra Digit III",
      icon: "6#",
      cost: 18000,
      section: "numbers",
      row: 4,
      col: 1,
      effect: "6 digits",
      description: "The digit lane reaches maximum length for jackpot multiplier patterns.",
      deps: ["number_sequence_2", "prestige_core"],
    },
    {
      id: "digit_multiplier_1",
      name: "Digit Multiplier I",
      icon: "x1",
      cost: 5200,
      section: "numbers",
      row: 2,
      col: 2,
      effect: "+10% number boosts",
      description: "Digit badge multipliers become stronger.",
      deps: ["number_attunement"],
    },
    {
      id: "digit_multiplier_2",
      name: "Digit Multiplier II",
      icon: "x2",
      cost: 11000,
      section: "numbers",
      row: 3,
      col: 2,
      effect: "+15% number boosts",
      description: "A bigger same-roll multiplier engine for digit badges.",
      deps: ["digit_multiplier_1", "digit_alchemy"],
    },
    {
      id: "checksum_scanner",
      name: "Checksum Scanner",
      icon: "Σ",
      cost: 7600,
      section: "numbers",
      row: 2,
      col: 3,
      effect: "+8% number boosts",
      description: "Digit sums and checksum badges boost alphabet Glyphs harder.",
      deps: ["digit_alchemy"],
    },
    {
      id: "prime_resonator",
      name: "Prime Resonator",
      icon: "PR",
      cost: 12500,
      section: "numbers",
      row: 3,
      col: 3,
      effect: "+12% number boosts",
      description: "Prime-digit patterns resonate into stronger alphabet Glyph multipliers.",
      deps: ["checksum_scanner"],
    },
    {
      id: "zero_overdrive",
      name: "Zero Overdrive",
      icon: "00",
      cost: 15000,
      section: "numbers",
      row: 4,
      col: 2,
      effect: "+10% number boosts",
      description: "Zero-based digit badges become more dramatic.",
      deps: ["digit_multiplier_2"],
    },
    {
      id: "number_shimmer",
      name: "Digit Shimmer",
      icon: "NS",
      cost: 6200,
      section: "numbers",
      row: 1,
      col: 3,
      effect: "Digit glow",
      description: "Digit tiles get extra glow chances and visual punch.",
      deps: ["mixed_mode"],
    },
    {
      id: "digit_cutscene_core",
      name: "Digit Cutscene Core",
      icon: "DC",
      cost: 20000,
      section: "numbers",
      row: 4,
      col: 3,
      effect: "Number cutscene style",
      description: "Digit-multiplied rare rolls get their own rift flavor.",
      deps: ["prime_resonator", "zero_overdrive"],
    },
    {
      id: "cutscene_intensity",
      name: "Cutscene Intensity",
      icon: "CI",
      cost: 7800,
      section: "temporal",
      row: 2,
      col: 4,
      effect: "Heavier cutscenes",
      description: "Cutscenes get bigger lighting, movement, and impact.",
      deps: ["cutscene_director"],
    },
    {
      id: "variant_director",
      name: "Variant Director",
      icon: "VD",
      cost: 14000,
      section: "temporal",
      row: 3,
      col: 4,
      effect: "More variants",
      description: "Adds more distinct cutscene flavors for words, digits, and glitches.",
      deps: ["cutscene_intensity"],
    },
    {
      id: "rift_theater",
      name: "Rift Theater",
      icon: "RT",
      cost: 26000,
      section: "temporal",
      row: 4,
      col: 4,
      effect: "Maximum reveal drama",
      description: "Late-game cutscenes gain a wider stage and stronger finale.",
      deps: ["variant_director", "prestige_core"],
    }
  );

  UPGRADES.push(
    {
      id: "breakdown_lens",
      name: "Breakdown Lens",
      icon: "BL",
      cost: 7600,
      section: "core",
      row: 4,
      col: 4,
      effect: "+5% badge Glyphs",
      description: "Makes the badge breakdown more profitable without hiding any badges behind upgrades.",
      deps: ["discovery_surge"],
    },
    {
      id: "glyph_foundry",
      name: "Glyph Foundry",
      icon: "GF",
      cost: 18000,
      section: "core",
      row: 5,
      col: 3,
      effect: "+10% final Glyphs",
      description: "A late-game forge that boosts the final Glyph total after the digit multiplier resolves.",
      deps: ["glyph_amplifier", "breakdown_lens", "prestige_core"],
    },
    {
      id: "word_primer",
      name: "Word Primer",
      icon: "WP",
      cost: 9200,
      section: "scanner",
      row: 5,
      col: 1,
      effect: "+6% word payouts",
      description: "Rewards clean 4+ letter word finds and Gemini-confirmed discoveries.",
      deps: ["word_dividend"],
    },
    {
      id: "lexicon_engine",
      name: "Lexicon Engine",
      icon: "LE",
      cost: 17000,
      section: "scanner",
      row: 6,
      col: 1,
      effect: "+9% word payouts",
      description: "A deeper language scanner for huge words and multi-word rolls.",
      deps: ["word_primer", "prestige_core"],
    },
    {
      id: "mirror_chamber",
      name: "Mirror Chamber",
      icon: "MC",
      cost: 8800,
      section: "scanner",
      row: 5,
      col: 2,
      effect: "+6% mirror payouts",
      description: "Makes palindromes, bookends, and symmetry badges feel heavier.",
      deps: ["mirror_polish"],
    },
    {
      id: "pattern_crown",
      name: "Pattern Crown",
      icon: "PC",
      cost: 15500,
      section: "scanner",
      row: 5,
      col: 3,
      effect: "+8% pattern payouts",
      description: "Stacks extra value onto runs, pairs, walls, snakes, and zigzags.",
      deps: ["alphabet_overclock", "mirror_chamber"],
    },
    {
      id: "digit_circuit",
      name: "Digit Circuit",
      icon: "DC",
      cost: 16500,
      section: "numbers",
      row: 5,
      col: 3,
      effect: "+7% number boosts",
      description: "Common digit badges stay small, but the whole multiplier lane becomes a bit sharper.",
      deps: ["prime_resonator"],
    },
    {
      id: "digit_relay",
      name: "Digit Relay",
      icon: "DR",
      cost: 24000,
      section: "numbers",
      row: 5,
      col: 4,
      effect: "+8% number boosts",
      description: "A late digit relay for stacked number badge multipliers.",
      deps: ["digit_circuit", "digit_cutscene_core"],
    },
    {
      id: "sequence_expander_3",
      name: "Compact Scanner",
      icon: "CS",
      cost: 6500,
      section: "temporal",
      row: 4,
      col: 2,
      effect: "+5% 4-6L badge value",
      description: "Improves badges tied to the 4, 5, and 6-letter lanes without adding more dice.",
      deps: ["sequence_expander_2"],
    },
    {
      id: "sequence_expander_4",
      name: "Max-Lane Tuning",
      icon: "6+",
      cost: 9800,
      section: "temporal",
      row: 5,
      col: 2,
      effect: "+7% 6L badge value",
      description: "Six letters stays the hard cap. This tunes rewards for clean max-lane rolls.",
      deps: ["sequence_expander_3"],
    },
    {
      id: "cutscene_gallery",
      name: "Scene Gallery",
      icon: "SG",
      cost: 11000,
      section: "temporal",
      row: 5,
      col: 4,
      effect: "Archive polish",
      description: "Polishes the cutscene archive preview system. Scenes are still based on rare badges, not upgrade access.",
      deps: ["variant_director"],
    },
    {
      id: "epic_projector",
      name: "Epic Projector",
      icon: "EP",
      cost: 21000,
      section: "endgame",
      row: 2,
      col: 3,
      effect: "Epic+ scene glow",
      description: "Makes very rare badge scenes punch harder with brighter projection lighting.",
      deps: ["mythic_lens", "cutscene_gallery"],
    }
  );

  const UPGRADE_LAYOUT_OVERRIDES = {
    better_luck_1: { section: "core", row: 1, col: 1 },
    better_luck_2: { section: "core", row: 2, col: 1 },
    better_luck_3: { section: "core", row: 3, col: 1 },
    better_luck_4: { section: "core", row: 4, col: 1 },
    badge_hunter: { section: "core", row: 2, col: 2 },
    badge_hunter_2: { section: "core", row: 3, col: 2 },
    glyph_amplifier: { section: "core", row: 4, col: 2 },
    auto_claim: { section: "core", row: 2, col: 3 },
    discovery_surge: { section: "core", row: 3, col: 3 },
    breakdown_lens: { section: "core", row: 4, col: 3 },
    fortune_resonator: { section: "core", row: 5, col: 2 },
    glyph_foundry: { section: "core", row: 5, col: 3 },

    combo_scanner: { section: "scanner", row: 1, col: 1 },
    word_lens: { section: "scanner", row: 2, col: 1 },
    phrase_matrix: { section: "scanner", row: 3, col: 1 },
    word_dividend: { section: "scanner", row: 4, col: 1 },
    word_primer: { section: "scanner", row: 5, col: 1 },
    lexicon_engine: { section: "scanner", row: 6, col: 1 },
    mirror_array: { section: "scanner", row: 2, col: 2 },
    pattern_engine: { section: "scanner", row: 3, col: 2 },
    mirror_polish: { section: "scanner", row: 4, col: 2 },
    mirror_chamber: { section: "scanner", row: 5, col: 2 },
    alphabet_radar: { section: "scanner", row: 2, col: 3 },
    rare_letter_radar: { section: "scanner", row: 3, col: 3 },
    alphabet_overclock: { section: "scanner", row: 4, col: 3 },
    pattern_crown: { section: "scanner", row: 5, col: 3 },

    mixed_mode: { section: "numbers", row: 1, col: 1 },
    number_attunement: { section: "numbers", row: 1, col: 2 },
    number_shimmer: { section: "numbers", row: 1, col: 3 },
    digit_alchemy: { section: "numbers", row: 1, col: 4 },
    number_sequence_1: { section: "numbers", row: 2, col: 1 },
    number_sequence_2: { section: "numbers", row: 3, col: 1 },
    number_sequence_3: { section: "numbers", row: 4, col: 1 },
    digit_multiplier_1: { section: "numbers", row: 2, col: 2 },
    digit_multiplier_2: { section: "numbers", row: 3, col: 2 },
    zero_overdrive: { section: "numbers", row: 4, col: 2 },
    mixed_mastery: { section: "numbers", row: 5, col: 2 },
    checksum_scanner: { section: "numbers", row: 2, col: 3 },
    prime_resonator: { section: "numbers", row: 3, col: 3 },
    digit_cutscene_core: { section: "numbers", row: 4, col: 3 },
    digit_circuit: { section: "numbers", row: 5, col: 3 },
    digit_relay: { section: "numbers", row: 5, col: 4 },

    shorter_cooldown_1: { section: "temporal", row: 1, col: 1 },
    shorter_cooldown_2: { section: "temporal", row: 2, col: 1 },
    shorter_cooldown_3: { section: "temporal", row: 3, col: 1 },
    shorter_cooldown_4: { section: "temporal", row: 4, col: 1 },
    chrono_core: { section: "temporal", row: 5, col: 1 },
    bigger_sequence: { section: "temporal", row: 1, col: 2 },
    sequence_expander_2: { section: "temporal", row: 2, col: 2 },
    sequence_expander_3: { section: "temporal", row: 3, col: 2 },
    sequence_expander_4: { section: "temporal", row: 4, col: 2 },
    colossal_sequence: { section: "temporal", row: 5, col: 2 },
    lucky_reveal: { section: "temporal", row: 1, col: 3 },
    shimmer_coils: { section: "temporal", row: 2, col: 3 },
    cutscene_director: { section: "temporal", row: 1, col: 4 },
    cutscene_intensity: { section: "temporal", row: 2, col: 4 },
    variant_director: { section: "temporal", row: 3, col: 4 },
    rift_theater: { section: "temporal", row: 4, col: 4 },
    cutscene_gallery: { section: "temporal", row: 5, col: 4 },

    prestige_core: { section: "endgame", row: 1, col: 1 },
    mythic_lens: { section: "endgame", row: 2, col: 1 },
    glitch_conductor: { section: "endgame", row: 3, col: 1 },
    celestial_archive: { section: "endgame", row: 3, col: 2 },
    epic_projector: { section: "endgame", row: 2, col: 3 },
    alpha_omega_core: { section: "endgame", row: 4, col: 2 },
  };

  UPGRADES.forEach((upgrade) => {
    Object.assign(upgrade, UPGRADE_LAYOUT_OVERRIDES[upgrade.id] || {});
  });

  const DICE_ONLY_UPGRADE_SECTIONS = [
    {
      id: "letters",
      title: "Alphabet Dice",
      subtitle: "Only adds more alphabet dice. Badges and cutscenes are always discoverable.",
      defaultOpen: true,
    },
    {
      id: "numbers",
      title: "Number Dice",
      subtitle: "Only adds more digit dice for the same-roll multiplier lane.",
      defaultOpen: true,
    },
  ];

  const DICE_ONLY_UPGRADES = [
    {
      id: "bigger_sequence",
      name: "Alphabet Die V",
      icon: "5A",
      cost: 900,
      section: "letters",
      row: 1,
      col: 1,
      effect: "5 alphabet dice",
      description: "Adds a fifth alphabet die. More letters mean richer word and pattern badge chances.",
      deps: [],
    },
    {
      id: "sequence_expander_2",
      name: "Alphabet Die VI",
      icon: "6A",
      cost: 3200,
      section: "letters",
      row: 1,
      col: 2,
      effect: "6 alphabet dice",
      description: "Raises the alphabet lane to the hard cap of six dice.",
      deps: ["bigger_sequence"],
    },
    {
      id: "number_sequence_1",
      name: "Digit Die III",
      icon: "3#",
      cost: 1200,
      section: "numbers",
      row: 1,
      col: 1,
      effect: "3 digit dice",
      description: "Adds a third digit die. Number badges still only multiply alphabet badge Glyphs.",
      deps: [],
    },
    {
      id: "number_sequence_2",
      name: "Digit Die IV",
      icon: "4#",
      cost: 3600,
      section: "numbers",
      row: 1,
      col: 2,
      effect: "4 digit dice",
      description: "Adds a fourth digit die for stronger multiplier patterns.",
      deps: ["number_sequence_1"],
    },
    {
      id: "number_sequence_3",
      name: "Digit Dice V-VI",
      icon: "6#",
      cost: 9000,
      section: "numbers",
      row: 1,
      col: 3,
      effect: "6 digit dice",
      description: "Raises the digit lane to six dice, matching the alphabet lane cap.",
      deps: ["number_sequence_2"],
    },
  ];

  const ACTIVE_UPGRADE_IDS = new Set(DICE_ONLY_UPGRADES.map((upgrade) => upgrade.id));

  UPGRADE_SECTIONS.length = 0;
  UPGRADE_SECTIONS.push(...DICE_ONLY_UPGRADE_SECTIONS);
  UPGRADES.length = 0;
  UPGRADES.push(...DICE_ONLY_UPGRADES);

  const BADGES = [
    {
      id: "double_trouble",
      name: "Double Trouble",
      description: "At least 2 matching characters appear in the sequence.",
      rarity: "common",
      value: 20,
      icon: "2",
      condition: (ctx) => ctx.maxCount >= 2,
    },
    {
      id: "triple_threat",
      name: "Triple Threat",
      description: "Three matching characters appear in one roll.",
      rarity: "uncommon",
      value: 60,
      icon: "3",
      condition: (ctx) => ctx.maxCount >= 3,
    },
    {
      id: "quad_core",
      name: "Quad Core",
      description: "Four matching characters land together.",
      rarity: "rare",
      value: 160,
      icon: "4",
      condition: (ctx) => ctx.maxCount >= 4,
    },
    {
      id: "alphabet_king",
      name: "Alphabet King",
      description: "Every character in the sequence is the same.",
      rarity: "mythic",
      value: 3000,
      icon: "A",
      condition: (ctx) => ctx.maxCount === ctx.sequence.length && ctx.sequence.length > 0,
    },
    {
      id: "vowel_storm",
      name: "Vowel Storm",
      description: "Four or more vowels appear in the roll.",
      rarity: "rare",
      value: 150,
      icon: "V",
      condition: (ctx) => ctx.vowelCount >= 4,
    },
    {
      id: "no_vowels",
      name: "No Vowels",
      description: "The sequence contains no vowels at all.",
      rarity: "uncommon",
      value: 55,
      icon: "\u00d8",
      condition: (ctx) => ctx.vowelCount === 0,
    },
    {
      id: "abc_run",
      name: "ABC Run",
      description: "The sequence contains ABC in order.",
      rarity: "epic",
      value: 500,
      icon: "ABC",
      condition: (ctx) => ctx.sequence.includes("ABC"),
    },
    {
      id: "reverse_run",
      name: "Reverse Run",
      description: "The sequence contains ZYX or CBA.",
      rarity: "epic",
      value: 520,
      icon: "\u21ba",
      condition: (ctx) => ctx.sequence.includes("ZYX") || ctx.sequence.includes("CBA"),
    },
    {
      id: "palindrome",
      name: "Palindrome",
      description: "The sequence reads the same forwards and backwards.",
      rarity: "legendary",
      value: 1200,
      icon: "\u21c4",
      condition: (ctx) => ctx.sequence === reverseString(ctx.sequence),
    },
    {
      id: "keyboard_chaos",
      name: "Keyboard Chaos",
      description: "Every character is different.",
      rarity: "common",
      value: 25,
      icon: "\u2328",
      condition: (ctx) => ctx.uniqueCount === ctx.sequence.length,
    },
    {
      id: "lucky_seven",
      name: "Lucky Seven",
      description: "Alphabet-position total has a remainder of 7 when divided by 10.",
      rarity: "rare",
      value: 175,
      icon: "7",
      condition: (ctx) => ctx.alphaScore % 10 === 7,
    },
    {
      id: "high_alphabet",
      name: "High Alphabet",
      description: "Most letters are from N-Z.",
      rarity: "uncommon",
      value: 65,
      icon: "NZ",
      condition: (ctx) => ctx.letterCount > 0 && ctx.highCount >= Math.ceil(ctx.letterCount * 0.66),
    },
    {
      id: "low_alphabet",
      name: "Low Alphabet",
      description: "Most letters are from A-M.",
      rarity: "uncommon",
      value: 65,
      icon: "AM",
      condition: (ctx) => ctx.letterCount > 0 && ctx.lowCount >= Math.ceil(ctx.letterCount * 0.66),
    },
    {
      id: "snake_pattern",
      name: "Snake Pattern",
      description: "Letters alternate vowel, consonant, vowel, consonant, or the reverse.",
      rarity: "epic",
      value: 460,
      icon: "S",
      condition: (ctx) => ctx.letterCount === ctx.sequence.length && isAlternatingVowelConsonant(ctx.sequence),
    },
    {
      id: "glitched_roll",
      name: "Glitched Roll",
      description: "A very rare luck-touched bonus badge.",
      rarity: "glitched",
      value: 1800,
      icon: "\u26a1",
      condition: (ctx) => ctx.glitchedBonus,
    },
    {
      id: "word_spark",
      name: "Word Spark",
      description: "Detect one 4+ letter built-in dictionary word in your sequence.",
      rarity: "uncommon",
      value: 90,
      icon: "Aa",
      condition: (ctx) => ctx.words.length >= 1,
    },
    {
      id: "word_weaver",
      name: "Word Weaver",
      description: "Detect two or more 4+ letter local dictionary words in one roll.",
      rarity: "rare",
      value: 260,
      icon: "W",
      condition: (ctx) => ctx.words.length >= 2,
    },
    {
      id: "full_word",
      name: "Perfectly Said",
      description: "The full sequence is a recognized word.",
      rarity: "legendary",
      value: 1500,
      icon: "\u270e",
      condition: (ctx) => ctx.fullSequenceWord,
    },
    {
      id: "edge_case",
      name: "Edge Case",
      description: "Your roll includes both A and Z.",
      rarity: "rare",
      value: 210,
      icon: "AZ",
      condition: (ctx) => ctx.sequence.includes("A") && ctx.sequence.includes("Z"),
    },
    {
      id: "pair_parade",
      name: "Pair Parade",
      description: "Three separate pairs appear in one sequence.",
      rarity: "epic",
      value: 620,
      icon: "++",
      requiresUpgrade: "combo_scanner",
      condition: (ctx) => ctx.pairCount >= 3,
    },
    {
      id: "ladder_up",
      name: "Ladder Up",
      description: "Contains any ascending 3-letter alphabet run, like BCD.",
      rarity: "rare",
      value: 240,
      icon: "\u2197",
      requiresUpgrade: "combo_scanner",
      condition: (ctx) => hasAlphabetRun(ctx.sequence, 3, 1),
    },
    {
      id: "ladder_down",
      name: "Ladder Down",
      description: "Contains any descending 3-letter alphabet run, like RQP.",
      rarity: "rare",
      value: 240,
      icon: "\u2198",
      requiresUpgrade: "combo_scanner",
      condition: (ctx) => hasAlphabetRun(ctx.sequence, 3, -1),
    },
    {
      id: "lexicon_burst",
      name: "Lexicon Burst",
      description: "Find three or more 4+ letter local dictionary words in one roll.",
      rarity: "epic",
      value: 700,
      icon: "LB",
      requiresUpgrade: "combo_scanner",
      condition: (ctx) => ctx.words.length >= 3,
    },
    {
      id: "mirror_pair",
      name: "Mirror Pair",
      description: "The first and last characters match.",
      rarity: "uncommon",
      value: 70,
      icon: "\u25c7",
      requiresUpgrade: "combo_scanner",
      condition: (ctx) => ctx.sequence[0] === ctx.sequence[ctx.sequence.length - 1],
    },
    {
      id: "mixed_signal",
      name: "Digit Sync",
      description: "The digit lane is active beside the alphabet lane.",
      rarity: "rare",
      value: 260,
      numberMultiplier: 0.03,
      icon: "N#",
      requiresMixed: true,
      condition: (ctx) => ctx.isNumberRoll,
    },
    {
      id: "number_spark",
      name: "Number Spark",
      description: "The digit lane contains three or more digits.",
      rarity: "uncommon",
      value: 95,
      numberMultiplier: 0.06,
      icon: "123",
      requiresMixed: true,
      condition: (ctx) => ctx.numberCount >= 3,
    },
    {
      id: "numeric_run",
      name: "Numeric Run",
      description: "The digit lane contains 123, 456, or 789.",
      rarity: "epic",
      value: 680,
      numberMultiplier: 0.1,
      icon: "#",
      requiresMixed: true,
      condition: (ctx) => /123|456|789/.test(ctx.sequence),
    },
    {
      id: "zero_signal",
      name: "Zero Signal",
      description: "The digit lane catches the zero signal.",
      rarity: "common",
      value: 35,
      numberMultiplier: 0.05,
      icon: "0",
      requiresMixed: true,
      condition: (ctx) => ctx.sequence.includes("0"),
    },
    {
      id: "sixty_seven_surge",
      name: "Sixty-Seven Surge",
      description: "The digit lane contains 67. Adds a strong same-roll multiplier to alphabet badge Glyphs.",
      rarity: "rare",
      value: 0,
      numberMultiplier: 0.5,
      icon: "67",
      rollMode: "numbers",
      condition: (ctx) => ctx.sequence.includes("67"),
    },
    {
      id: "luck_surge",
      name: "Luck Surge",
      description: "A random bonus badge that becomes more likely with Luck.",
      rarity: "rare",
      value: 300,
      icon: "\u2726",
      condition: (ctx) => ctx.luckSurge,
    },
  ];

  BADGES.push(
    {
      id: "exact_pair",
      name: "Exact Pair",
      description: "Exactly one pair appears, with no triples or higher.",
      rarity: "common",
      value: 35,
      icon: "2x",
      requiresUpgrade: "pattern_engine",
      condition: (ctx) => ctx.exactPairCount === 1 && ctx.maxCount === 2,
    },
    {
      id: "two_pair_tango",
      name: "Two-Pair Tango",
      description: "Two different characters each appear at least twice.",
      rarity: "uncommon",
      value: 95,
      icon: "22",
      requiresUpgrade: "pattern_engine",
      condition: (ctx) => ctx.pairCount >= 2,
    },
    {
      id: "full_house",
      name: "Full House",
      description: "A triple and a separate pair land together.",
      rarity: "epic",
      value: 760,
      icon: "FH",
      requiresUpgrade: "pattern_engine",
      condition: (ctx) => ctx.hasTriple && ctx.hasPair,
    },
    {
      id: "fivefold_signal",
      name: "Fivefold Signal",
      description: "Five matching characters appear in one roll.",
      rarity: "legendary",
      value: 1450,
      icon: "5",
      requiresUpgrade: "pattern_engine",
      condition: (ctx) => ctx.maxCount >= 5,
    },
    {
      id: "double_tap",
      name: "Double Tap",
      description: "Two identical characters sit next to each other.",
      rarity: "common",
      value: 45,
      icon: "||",
      requiresUpgrade: "pattern_engine",
      condition: (ctx) => ctx.hasAdjacentRepeat,
    },
    {
      id: "triple_stack",
      name: "Triple Stack",
      description: "Three identical characters appear consecutively.",
      rarity: "rare",
      value: 310,
      icon: "|||",
      requiresUpgrade: "pattern_engine",
      condition: (ctx) => ctx.hasAdjacentTriple,
    },
    {
      id: "sandwich_code",
      name: "Sandwich Code",
      description: "A character repeats with one character between it, like ABA.",
      rarity: "uncommon",
      value: 110,
      icon: "ABA",
      requiresUpgrade: "pattern_engine",
      condition: (ctx) => ctx.hasSandwich,
    },
    {
      id: "bookends",
      name: "Bookends",
      description: "The first and last tiles match.",
      rarity: "uncommon",
      value: 85,
      icon: "[]",
      requiresUpgrade: "mirror_array",
      condition: (ctx) => ctx.firstChar === ctx.lastChar,
    },
    {
      id: "inner_mirror",
      name: "Inner Mirror",
      description: "The second and second-last tiles match.",
      rarity: "rare",
      value: 260,
      icon: "<>",
      requiresUpgrade: "mirror_array",
      condition: (ctx) => ctx.sequence.length >= 4 && ctx.sequence[1] === ctx.sequence[ctx.sequence.length - 2],
    },
    {
      id: "half_mirror",
      name: "Half Mirror",
      description: "At least two mirrored tile pairs match.",
      rarity: "epic",
      value: 680,
      icon: "HM",
      requiresUpgrade: "mirror_array",
      condition: (ctx) => ctx.symmetryPairs >= 2,
    },
    {
      id: "rare_letter",
      name: "Rare Letter",
      description: "The sequence includes Q, X, Z, or J.",
      rarity: "common",
      value: 50,
      icon: "QZ",
      requiresUpgrade: "rare_letter_radar",
      condition: (ctx) => ctx.rareLetterCount >= 1,
    },
    {
      id: "rare_cluster",
      name: "Rare Cluster",
      description: "Two or more rare letters appear.",
      rarity: "rare",
      value: 340,
      icon: "RX",
      requiresUpgrade: "rare_letter_radar",
      condition: (ctx) => ctx.rareLetterCount >= 2,
    },
    {
      id: "q_without_u",
      name: "Q Without U",
      description: "Q appears without U.",
      rarity: "epic",
      value: 620,
      icon: "Q!",
      requiresUpgrade: "rare_letter_radar",
      condition: (ctx) => ctx.sequence.includes("Q") && !ctx.sequence.includes("U"),
    },
    {
      id: "x_marks",
      name: "X Marks",
      description: "X appears in the roll.",
      rarity: "common",
      value: 45,
      icon: "X",
      requiresUpgrade: "rare_letter_radar",
      condition: (ctx) => ctx.sequence.includes("X"),
    },
    {
      id: "zed_zone",
      name: "Zed Zone",
      description: "Z appears in the roll.",
      rarity: "common",
      value: 45,
      icon: "Z",
      requiresUpgrade: "rare_letter_radar",
      condition: (ctx) => ctx.sequence.includes("Z"),
    },
    {
      id: "alpha_omega",
      name: "Alpha Omega",
      description: "The roll starts with A and ends with Z, or the reverse.",
      rarity: "legendary",
      value: 1600,
      icon: "AZ",
      requiresUpgrade: "alphabet_radar",
      condition: (ctx) => (ctx.firstChar === "A" && ctx.lastChar === "Z") || (ctx.firstChar === "Z" && ctx.lastChar === "A"),
    },
    {
      id: "alphabet_span",
      name: "Alphabet Span",
      description: "Letters span at least 20 alphabet positions.",
      rarity: "rare",
      value: 260,
      icon: "A-Z",
      requiresUpgrade: "alphabet_radar",
      condition: (ctx) => ctx.alphabetSpan >= 20,
    },
    {
      id: "balanced_scale",
      name: "Balanced Scale",
      description: "A-M and N-Z appear in equal amounts.",
      rarity: "uncommon",
      value: 120,
      icon: "==",
      requiresUpgrade: "alphabet_radar",
      condition: (ctx) => ctx.letterCount > 1 && ctx.highCount === ctx.lowCount,
    },
    {
      id: "prime_signal",
      name: "Prime Signal",
      description: "Alphabet-position total is a prime number.",
      rarity: "rare",
      value: 330,
      icon: "P",
      requiresUpgrade: "alphabet_radar",
      condition: (ctx) => isPrime(ctx.alphaScore),
    },
    {
      id: "perfect_hundred",
      name: "Perfect Hundred",
      description: "Alphabet-position total equals exactly 100.",
      rarity: "legendary",
      value: 1700,
      icon: "100",
      requiresUpgrade: "alphabet_radar",
      condition: (ctx) => ctx.alphaScore === 100,
    },
    {
      id: "zigzag_signal",
      name: "Zigzag Signal",
      description: "Alphabet values alternate up and down across the roll.",
      rarity: "epic",
      value: 720,
      icon: "ZZ",
      requiresUpgrade: "alphabet_radar",
      condition: (ctx) => ctx.zigzagAlphabet,
    },
    {
      id: "high_low_switch",
      name: "High-Low Switch",
      description: "Letters alternate between A-M and N-Z.",
      rarity: "epic",
      value: 650,
      icon: "HL",
      requiresUpgrade: "alphabet_radar",
      condition: (ctx) => ctx.highLowAlternating,
    },
    {
      id: "vowel_crown",
      name: "Vowel Crown",
      description: "Every letter in the roll is a vowel.",
      rarity: "legendary",
      value: 1550,
      icon: "AE",
      requiresUpgrade: "pattern_engine",
      condition: (ctx) => ctx.letterCount > 0 && ctx.letterCount === ctx.sequence.length && ctx.vowelCount === ctx.letterCount,
    },
    {
      id: "consonant_wall",
      name: "Consonant Wall",
      description: "At least five consonants appear.",
      rarity: "rare",
      value: 300,
      icon: "CW",
      requiresUpgrade: "pattern_engine",
      condition: (ctx) => ctx.consonantCount >= 5,
    },
    {
      id: "vowel_run",
      name: "Vowel Run",
      description: "Three vowels appear consecutively.",
      rarity: "rare",
      value: 360,
      icon: "VVV",
      requiresUpgrade: "pattern_engine",
      condition: (ctx) => ctx.hasVowelRun,
    },
    {
      id: "consonant_run",
      name: "Consonant Run",
      description: "Four consonants appear consecutively.",
      rarity: "uncommon",
      value: 130,
      icon: "CCCC",
      requiresUpgrade: "pattern_engine",
      condition: (ctx) => ctx.hasConsonantRun,
    },
    {
      id: "four_letter_word",
      name: "Four-Letter Find",
      description: "Find a word of length 4 or more.",
      rarity: "uncommon",
      value: 120,
      icon: "4W",
      requiresUpgrade: "word_lens",
      condition: (ctx) => ctx.longestWordLength >= 4,
    },
    {
      id: "five_letter_word",
      name: "Five-Letter Find",
      description: "Find a word of length 5 or more.",
      rarity: "rare",
      value: 380,
      icon: "5W",
      requiresUpgrade: "word_lens",
      condition: (ctx) => ctx.longestWordLength >= 5,
    },
    {
      id: "six_letter_word",
      name: "Six-Letter Find",
      description: "Find a word of length 6 or more.",
      rarity: "legendary",
      value: 1500,
      icon: "6W",
      requiresUpgrade: "phrase_matrix",
      condition: (ctx) => ctx.longestWordLength >= 6,
    },
    {
      id: "word_cover",
      name: "Word Cover",
      description: "A detected word covers at least 70% of the sequence.",
      rarity: "epic",
      value: 760,
      icon: "WC",
      requiresUpgrade: "phrase_matrix",
      condition: (ctx) => ctx.wordCoverage >= 0.7,
    },
    {
      id: "digit_pair",
      name: "Digit Pair",
      description: "Two matching digits appear in the digit lane.",
      rarity: "uncommon",
      value: 110,
      numberMultiplier: 0.06,
      icon: "##",
      requiresMixed: true,
      requiresUpgrade: "number_attunement",
      condition: (ctx) => ctx.numberPairCount >= 1,
    },
    {
      id: "serial_digits",
      name: "Serial Digits",
      description: "The digit lane produces three or more digits.",
      rarity: "rare",
      value: 300,
      numberMultiplier: 0.08,
      icon: "S#",
      requiresMixed: true,
      requiresUpgrade: "number_attunement",
      condition: (ctx) => ctx.numberCount >= 3,
    },
    {
      id: "binary_pulse",
      name: "Binary Pulse",
      description: "The roll contains both 0 and 1.",
      rarity: "rare",
      value: 280,
      numberMultiplier: 0.08,
      icon: "01",
      requiresMixed: true,
      requiresUpgrade: "number_attunement",
      condition: (ctx) => ctx.numberCount >= 3 && ctx.sequence.includes("0") && ctx.sequence.includes("1"),
    },
    {
      id: "digit_sum_seven",
      name: "Digit Sum Seven",
      description: "All digits in the roll add up to exactly 7.",
      rarity: "epic",
      value: 680,
      numberMultiplier: 0.1,
      icon: "7#",
      requiresMixed: true,
      requiresUpgrade: "digit_alchemy",
      condition: (ctx) => ctx.numberCount > 0 && ctx.digitSum === 7,
    },
    {
      id: "digit_mirror",
      name: "Digit Mirror",
      description: "The first and last characters are the same number.",
      rarity: "epic",
      value: 720,
      numberMultiplier: 0.1,
      icon: "#M",
      requiresMixed: true,
      requiresUpgrade: "digit_alchemy",
      condition: (ctx) => ctx.numberCount >= 3 && /\d/.test(ctx.firstChar) && ctx.firstChar === ctx.lastChar,
    },
    {
      id: "mixed_master",
      name: "Digit Master",
      description: "The digit lane has at least five unique digits.",
      rarity: "epic",
      value: 820,
      numberMultiplier: 0.12,
      icon: "D+",
      requiresMixed: true,
      requiresUpgrade: "mixed_mastery",
      condition: (ctx) => ctx.isNumberRoll && ctx.digitUniqueCount >= 5,
    },
    {
      id: "mythic_pulse",
      name: "Mythic Pulse",
      description: "A tiny endgame resonance bonus triggers.",
      rarity: "mythic",
      value: 2200,
      icon: "MP",
      requiresUpgrade: "mythic_lens",
      condition: (ctx) => ctx.mythicPulse,
    },
    {
      id: "omega_archive",
      name: "Omega Archive",
      description: "A massive max-lane roll hits rare letters and long words.",
      rarity: "mythic",
      value: 2600,
      icon: "OA",
      requiresUpgrade: "alpha_omega_core",
      condition: (ctx) => ctx.sequence.length === 6 && ctx.longestWordLength >= 5 && ctx.rareLetterCount >= 1,
    }
  );

  BADGES.push(
    {
      id: "front_loaded",
      name: "Front Loaded",
      description: "The roll starts with A, B, or C.",
      rarity: "common",
      value: 40,
      icon: "ABC",
      rollMode: "letters",
      condition: (ctx) => ["A", "B", "C"].includes(ctx.firstChar),
    },
    {
      id: "z_finish",
      name: "Z Finish",
      description: "The roll ends with X, Y, or Z.",
      rarity: "common",
      value: 45,
      icon: "XYZ",
      rollMode: "letters",
      condition: (ctx) => ["X", "Y", "Z"].includes(ctx.lastChar),
    },
    {
      id: "royal_pair",
      name: "Royal Pair",
      description: "K and Q both appear in the same letter roll.",
      rarity: "rare",
      value: 330,
      icon: "KQ",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.includes("K") && ctx.sequence.includes("Q"),
    },
    {
      id: "vowel_balance",
      name: "Vowel Balance",
      description: "Exactly half of the letters are vowels.",
      rarity: "rare",
      value: 320,
      icon: "50",
      rollMode: "letters",
      condition: (ctx) => ctx.letterCount > 0 && ctx.vowelCount * 2 === ctx.letterCount,
    },
    {
      id: "center_vowel",
      name: "Center Vowel",
      description: "A vowel lands in the center of the roll.",
      rarity: "uncommon",
      value: 115,
      icon: "CV",
      rollMode: "letters",
      condition: (ctx) => {
        const mid = Math.floor(ctx.sequence.length / 2);
        return VOWELS.has(ctx.sequence[mid]) || (ctx.sequence.length % 2 === 0 && VOWELS.has(ctx.sequence[mid - 1]));
      },
    },
    {
      id: "letter_spectrum",
      name: "Letter Spectrum",
      description: "The roll includes a low, middle, and high alphabet letter.",
      rarity: "epic",
      value: 640,
      icon: "LMH",
      rollMode: "letters",
      condition: (ctx) => {
        const positions = ctx.letters.map(getAlphabetPosition);
        return positions.some((value) => value <= 8) && positions.some((value) => value >= 9 && value <= 18) && positions.some((value) => value >= 19);
      },
    },
    {
      id: "alpha_sum_50",
      name: "Alpha Sum 50",
      description: "Alphabet-position total equals exactly 50.",
      rarity: "rare",
      value: 390,
      icon: "Σ50",
      rollMode: "letters",
      condition: (ctx) => ctx.alphaScore === 50,
    },
    {
      id: "alpha_sum_111",
      name: "Alpha Sum 111",
      description: "Alphabet-position total equals exactly 111.",
      rarity: "legendary",
      value: 1750,
      icon: "111",
      rollMode: "letters",
      condition: (ctx) => ctx.alphaScore === 111,
    },
    {
      id: "gemini_word",
      name: "Gemini Word",
      description: "Gemini confirms at least one word in the sequence.",
      rarity: "rare",
      value: 420,
      icon: "AI",
      rollMode: "letters",
      condition: (ctx) => ctx.words.some((word) => word.source === "gemini"),
    },
    {
      id: "long_word_hero",
      name: "Six-Word Hero",
      description: "Find a six-letter word at the max alphabet lane.",
      rarity: "mythic",
      value: 2800,
      icon: "6W+",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.length === 6 && ctx.longestWordLength >= 6,
    },
    {
      id: "digit_duo",
      name: "Digit Duo",
      description: "Exactly two different digits appear.",
      rarity: "common",
      value: 80,
      numberMultiplier: 0.05,
      icon: "D2",
      rollMode: "numbers",
      condition: (ctx) => ctx.isNumberRoll && ctx.digitUniqueCount === 2,
    },
    {
      id: "digit_rainbow",
      name: "Digit Rainbow",
      description: "At least six unique digits appear.",
      rarity: "epic",
      value: 760,
      numberMultiplier: 0.14,
      icon: "D6",
      rollMode: "numbers",
      condition: (ctx) => ctx.isNumberRoll && ctx.digitUniqueCount >= 6,
    },
    {
      id: "all_even",
      name: "Even Engine",
      description: "Every digit is even.",
      rarity: "rare",
      value: 360,
      numberMultiplier: 0.08,
      icon: "EV",
      rollMode: "numbers",
      condition: (ctx) => ctx.numberCount >= 3 && ctx.allEvenDigits,
    },
    {
      id: "all_odd",
      name: "Odd Engine",
      description: "Every digit is odd.",
      rarity: "rare",
      value: 360,
      numberMultiplier: 0.08,
      icon: "OD",
      rollMode: "numbers",
      condition: (ctx) => ctx.numberCount >= 3 && ctx.allOddDigits,
    },
    {
      id: "even_odd_balance",
      name: "Even-Odd Balance",
      description: "Even and odd digits appear in equal amounts.",
      rarity: "uncommon",
      value: 150,
      numberMultiplier: 0.05,
      icon: "EO",
      rollMode: "numbers",
      condition: (ctx) => ctx.isNumberRoll && ctx.numberCount >= 4 && ctx.evenDigitCount === ctx.oddDigitCount,
    },
    {
      id: "prime_party",
      name: "Prime Party",
      description: "At least four digits are 2, 3, 5, or 7.",
      rarity: "epic",
      value: 720,
      numberMultiplier: 0.12,
      icon: "PR",
      rollMode: "numbers",
      condition: (ctx) => ctx.primeDigitCount >= 4,
    },
    {
      id: "zero_duo",
      name: "Zero Duo",
      description: "Two or more zeroes appear.",
      rarity: "uncommon",
      value: 160,
      numberMultiplier: 0.06,
      icon: "00",
      rollMode: "numbers",
      condition: (ctx) => ctx.zeroCount >= 2,
    },
    {
      id: "void_stack",
      name: "Void Stack",
      description: "Three zeroes appear.",
      rarity: "legendary",
      value: 1500,
      numberMultiplier: 0.2,
      icon: "000",
      rollMode: "numbers",
      condition: (ctx) => ctx.zeroCount >= 3,
    },
    {
      id: "triple_seven",
      name: "Triple Seven",
      description: "Three or more 7s appear.",
      rarity: "legendary",
      value: 1700,
      numberMultiplier: 0.22,
      icon: "777",
      rollMode: "numbers",
      condition: (ctx) => (ctx.numberCounts["7"] || 0) >= 3,
    },
    {
      id: "ascending_digits",
      name: "Ascending Digits",
      description: "Three digits climb in order, like 345.",
      rarity: "rare",
      value: 380,
      numberMultiplier: 0.08,
      icon: "↗#",
      rollMode: "numbers",
      condition: (ctx) => ctx.digitAscendingRun,
    },
    {
      id: "descending_digits",
      name: "Descending Digits",
      description: "Three digits descend in order, like 654.",
      rarity: "rare",
      value: 380,
      numberMultiplier: 0.08,
      icon: "↘#",
      rollMode: "numbers",
      condition: (ctx) => ctx.digitDescendingRun,
    },
    {
      id: "digit_straight_four",
      name: "Four-Step Straight",
      description: "Four digits ascend or descend in a row.",
      rarity: "epic",
      value: 880,
      numberMultiplier: 0.15,
      icon: "4#",
      rollMode: "numbers",
      condition: (ctx) => ctx.digitStraightFour,
    },
    {
      id: "digital_palindrome",
      name: "Digital Palindrome",
      description: "The digit lane reads the same forward and backward.",
      rarity: "legendary",
      value: 1800,
      numberMultiplier: 0.22,
      icon: "#↔",
      rollMode: "numbers",
      condition: (ctx) => ctx.isNumberRoll && ctx.numberCount >= 4 && ctx.sequence === reverseString(ctx.sequence),
    },
    {
      id: "checksum_ten",
      name: "Checksum Ten",
      description: "Digit sum is divisible by 10.",
      rarity: "uncommon",
      value: 180,
      numberMultiplier: 0.06,
      icon: "Σ10",
      rollMode: "numbers",
      condition: (ctx) => ctx.isNumberRoll && ctx.digitSum > 0 && ctx.digitSum % 10 === 0,
    },
    {
      id: "checksum_21",
      name: "Checksum 21",
      description: "Digit sum equals exactly 21.",
      rarity: "rare",
      value: 440,
      numberMultiplier: 0.1,
      icon: "Σ21",
      rollMode: "numbers",
      condition: (ctx) => ctx.digitSum === 21,
    },
    {
      id: "checksum_42",
      name: "Checksum 42",
      description: "Digit sum equals exactly 42.",
      rarity: "legendary",
      value: 1900,
      numberMultiplier: 0.24,
      icon: "Σ42",
      rollMode: "numbers",
      condition: (ctx) => ctx.digitSum === 42,
    },
    {
      id: "pi_spark",
      name: "Pi Spark",
      description: "The sequence contains 314.",
      rarity: "epic",
      value: 820,
      numberMultiplier: 0.14,
      icon: "π",
      rollMode: "numbers",
      condition: (ctx) => ctx.sequence.includes("314"),
    },
    {
      id: "fibonacci_ping",
      name: "Fibonacci Ping",
      description: "The sequence contains 1123, 2358, or 112358.",
      rarity: "mythic",
      value: 2600,
      numberMultiplier: 0.3,
      icon: "Fib",
      rollMode: "numbers",
      condition: (ctx) => /112358|1123|2358/.test(ctx.sequence),
    },
    {
      id: "square_signal",
      name: "Square Signal",
      description: "The roll contains a two-digit square like 16, 25, 36, 49, 64, or 81.",
      rarity: "rare",
      value: 410,
      numberMultiplier: 0.09,
      icon: "□",
      rollMode: "numbers",
      condition: (ctx) => /16|25|36|49|64|81/.test(ctx.sequence),
    },
    {
      id: "binary_roll",
      name: "Binary Roll",
      description: "The whole roll uses only 0s and 1s.",
      rarity: "epic",
      value: 900,
      numberMultiplier: 0.16,
      icon: "01",
      rollMode: "numbers",
      condition: (ctx) => ctx.isNumberRoll && ctx.numberCount >= 4 && /^[01]+$/.test(ctx.sequence),
    },
    {
      id: "high_digits",
      name: "High Digits",
      description: "Most digits are 5-9.",
      rarity: "uncommon",
      value: 145,
      numberMultiplier: 0.05,
      icon: "5+",
      rollMode: "numbers",
      condition: (ctx) => ctx.isNumberRoll && ctx.numberCount >= 3 && ctx.digitValues.filter((value) => value >= 5).length >= Math.ceil(ctx.numberCount * 0.66),
    },
    {
      id: "low_digits",
      name: "Low Digits",
      description: "Most digits are 0-4.",
      rarity: "uncommon",
      value: 145,
      numberMultiplier: 0.05,
      icon: "0-4",
      rollMode: "numbers",
      condition: (ctx) => ctx.isNumberRoll && ctx.numberCount >= 3 && ctx.digitValues.filter((value) => value <= 4).length >= Math.ceil(ctx.numberCount * 0.66),
    }
  );

  BADGES.push(
    {
      id: "vowel_bookends",
      name: "Vowel Bookends",
      description: "The first and last alphabet tiles are both vowels.",
      rarity: "rare",
      value: 340,
      icon: "AE",
      rollMode: "letters",
      condition: (ctx) => VOWELS.has(ctx.firstChar) && VOWELS.has(ctx.lastChar),
    },
    {
      id: "rare_trinity",
      name: "Rare Trinity",
      description: "Three or more Q, X, Z, or J letters appear.",
      rarity: "epic",
      value: 880,
      icon: "QZX",
      rollMode: "letters",
      condition: (ctx) => ctx.rareLetterCount >= 3,
    },
    {
      id: "alphabet_quad_up",
      name: "Quad Ladder Up",
      description: "Contains any ascending 4-letter alphabet run, like CDEF.",
      rarity: "epic",
      value: 920,
      icon: "ABCD",
      rollMode: "letters",
      condition: (ctx) => hasAlphabetRun(ctx.sequence, 4, 1),
    },
    {
      id: "alphabet_quad_down",
      name: "Quad Ladder Down",
      description: "Contains any descending 4-letter alphabet run, like ZYXW.",
      rarity: "epic",
      value: 940,
      icon: "ZYXW",
      rollMode: "letters",
      condition: (ctx) => hasAlphabetRun(ctx.sequence, 4, -1),
    },
    {
      id: "all_low_wall",
      name: "Low Wall",
      description: "Every alphabet tile is from A-M.",
      rarity: "epic",
      value: 720,
      icon: "LOW",
      rollMode: "letters",
      condition: (ctx) => ctx.letterCount > 0 && ctx.lowCount === ctx.letterCount,
    },
    {
      id: "all_high_skyline",
      name: "High Skyline",
      description: "Every alphabet tile is from N-Z.",
      rarity: "epic",
      value: 740,
      icon: "HIGH",
      rollMode: "letters",
      condition: (ctx) => ctx.letterCount > 0 && ctx.highCount === ctx.letterCount,
    },
    {
      id: "alpha_sum_77",
      name: "Alpha Sum 77",
      description: "Alphabet-position total equals exactly 77.",
      rarity: "epic",
      value: 850,
      icon: "Σ77",
      rollMode: "letters",
      condition: (ctx) => ctx.alphaScore === 77,
    },
    {
      id: "word_monarch",
      name: "Word Monarch",
      description: "Find a six-letter word that fills the max alphabet lane.",
      rarity: "mythic",
      value: 3600,
      icon: "6W",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.length === 6 && ctx.longestWordLength >= 6,
    },
    {
      id: "opening_word",
      name: "Opening Word",
      description: "A detected 4+ letter word starts at the first tile.",
      rarity: "rare",
      value: 430,
      icon: "▶W",
      rollMode: "letters",
      condition: (ctx) => ctx.words.some((word) => Number(word.start) === 0),
    },
    {
      id: "ending_word",
      name: "Closing Word",
      description: "A detected 4+ letter word ends on the final tile.",
      rarity: "rare",
      value: 430,
      icon: "W◀",
      rollMode: "letters",
      condition: (ctx) => ctx.words.some((word) => Number(word.start) + Number(word.length || word.word?.length || 0) === ctx.sequence.length),
    },
    {
      id: "mirror_gate",
      name: "Mirror Gate",
      description: "Three or more mirrored tile pairs match.",
      rarity: "legendary",
      value: 1900,
      icon: "M3",
      rollMode: "letters",
      condition: (ctx) => ctx.symmetryPairs >= 3,
    },
    {
      id: "perfect_balance",
      name: "Perfect Balance",
      description: "Vowels and consonants appear in equal amounts.",
      rarity: "rare",
      value: 360,
      icon: "VC",
      rollMode: "letters",
      condition: (ctx) => ctx.letterCount >= 4 && ctx.vowelCount === ctx.consonantCount,
    },
    {
      id: "compact_core_4",
      name: "Compact Core",
      description: "Roll exactly 4 alphabet letters. A clean starter-lane signature.",
      rarity: "common",
      value: 45,
      icon: "4L",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.length === 4,
    },
    {
      id: "bridge_frame_5",
      name: "Bridge Frame",
      description: "Roll exactly 5 alphabet letters. The middle lane has its own rhythm.",
      rarity: "uncommon",
      value: 135,
      icon: "5L",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.length === 5,
    },
    {
      id: "sixfold_crown",
      name: "Sixfold Crown",
      description: "Roll exactly 6 alphabet letters. The max alphabet lane is active.",
      rarity: "rare",
      value: 360,
      icon: "6L",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.length === 6,
    },
    {
      id: "hydrogen",
      name: "Hydrogen",
      description: "The digit lane contains exactly one 1.",
      rarity: "common",
      value: 0,
      numberMultiplier: 0.05,
      icon: "H1",
      rollMode: "numbers",
      condition: (ctx) => (ctx.numberCounts["1"] || 0) === 1,
    },
    {
      id: "digit_lucky_seven",
      name: "Digit Lucky Seven",
      description: "The digit lane contains exactly one 7.",
      rarity: "common",
      value: 0,
      numberMultiplier: 0.05,
      icon: "7",
      rollMode: "numbers",
      condition: (ctx) => (ctx.numberCounts["7"] || 0) === 1,
    },
    {
      id: "liftoff",
      name: "Liftoff",
      description: "The first digit is larger than the last digit.",
      rarity: "common",
      value: 0,
      numberMultiplier: 0.04,
      icon: "🚀",
      rollMode: "numbers",
      condition: (ctx) => ctx.numberCount >= 2 && Number(ctx.firstChar) > Number(ctx.lastChar),
    },
    {
      id: "soft_landing",
      name: "Soft Landing",
      description: "The first digit is smaller than the last digit.",
      rarity: "common",
      value: 0,
      numberMultiplier: 0.04,
      icon: "↓",
      rollMode: "numbers",
      condition: (ctx) => ctx.numberCount >= 2 && Number(ctx.firstChar) < Number(ctx.lastChar),
    },
    {
      id: "odd_signal",
      name: "Odd Signal",
      description: "The digit sum is odd.",
      rarity: "common",
      value: 0,
      numberMultiplier: 0.03,
      icon: "OD",
      rollMode: "numbers",
      condition: (ctx) => ctx.numberCount > 0 && ctx.digitSum % 2 === 1,
    },
    {
      id: "even_signal",
      name: "Even Signal",
      description: "The digit sum is even.",
      rarity: "common",
      value: 0,
      numberMultiplier: 0.03,
      icon: "EV",
      rollMode: "numbers",
      condition: (ctx) => ctx.numberCount > 0 && ctx.digitSum % 2 === 0,
    },
    {
      id: "checksum_13",
      name: "Checksum 13",
      description: "Digit sum equals exactly 13.",
      rarity: "rare",
      value: 0,
      numberMultiplier: 0.08,
      icon: "Σ13",
      rollMode: "numbers",
      condition: (ctx) => ctx.digitSum === 13,
    },
    {
      id: "checksum_20",
      name: "Checksum 20",
      description: "Digit sum equals exactly 20.",
      rarity: "uncommon",
      value: 0,
      numberMultiplier: 0.06,
      icon: "Σ20",
      rollMode: "numbers",
      condition: (ctx) => ctx.digitSum === 20,
    },
    {
      id: "double_six",
      name: "Double Six",
      description: "The digit lane contains 66.",
      rarity: "rare",
      value: 0,
      numberMultiplier: 0.11,
      icon: "66",
      rollMode: "numbers",
      condition: (ctx) => ctx.sequence.includes("66"),
    },
    {
      id: "reverse_67",
      name: "Reverse Surge",
      description: "The digit lane contains 76, the mirror of the 67 surge.",
      rarity: "epic",
      value: 0,
      numberMultiplier: 0.14,
      icon: "76",
      rollMode: "numbers",
      condition: (ctx) => ctx.sequence.includes("76"),
    }
  );

  BADGES.push(
    {
      id: "starter_mirror_4",
      name: "Starter Mirror",
      description: "A 4-letter alphabet roll mirrors perfectly, like ABBA.",
      rarity: "rare",
      value: 620,
      icon: "4M",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.length === 4 && ctx.sequence === reverseString(ctx.sequence),
    },
    {
      id: "centerpiece_5",
      name: "Centerpiece Mirror",
      description: "A 5-letter alphabet roll forms a clean palindrome.",
      rarity: "legendary",
      value: 2100,
      icon: "5M",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.length === 5 && ctx.sequence === reverseString(ctx.sequence),
    },
    {
      id: "hex_mirror",
      name: "Hex Mirror",
      description: "A 6-letter alphabet roll mirrors perfectly from edge to edge.",
      rarity: "mythic",
      value: 7200,
      icon: "6M",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.length === 6 && ctx.sequence === reverseString(ctx.sequence),
    },
    {
      id: "quad_singularity",
      name: "Quad Singularity",
      description: "All 4 starter-lane alphabet tiles are the same letter.",
      rarity: "legendary",
      value: 3400,
      icon: "4X",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.length === 4 && ctx.maxCount === 4,
    },
    {
      id: "penta_singularity",
      name: "Penta Singularity",
      description: "All 5 alphabet tiles are the same letter.",
      rarity: "mythic",
      value: 12000,
      icon: "5X",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.length === 5 && ctx.maxCount === 5,
    },
    {
      id: "perfect_hex_singularity",
      name: "Perfect Hex Singularity",
      description: "All 6 alphabet tiles are the same letter. This is a chamber-breaking hit.",
      rarity: "glitched",
      value: 65000,
      icon: "6X",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.length === 6 && ctx.maxCount === 6,
    },
    {
      id: "aether_monolith",
      name: "Aether Monolith",
      description: "The alphabet lane rolls AAAAAA.",
      rarity: "glitched",
      value: 150000,
      icon: "AAAA",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence === "AAAAAA",
    },
    {
      id: "zenith_monolith",
      name: "Zenith Monolith",
      description: "The alphabet lane rolls ZZZZZZ.",
      rarity: "glitched",
      value: 150000,
      icon: "ZZZZ",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence === "ZZZZZZ",
    },
    {
      id: "ascension_six",
      name: "Ascension Six",
      description: "The alphabet lane rolls the exact ascending relic ABCDEF.",
      rarity: "glitched",
      value: 36000,
      icon: "A-F",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence === "ABCDEF",
    },
    {
      id: "descent_six",
      name: "Descent Six",
      description: "The alphabet lane rolls the exact descending relic ZYXWVU.",
      rarity: "glitched",
      value: 36000,
      icon: "Z-U",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence === "ZYXWVU",
    },
    {
      id: "void_alphabet",
      name: "Void Alphabet",
      description: "Every max-lane letter is one of Q, X, Z, or J.",
      rarity: "mythic",
      value: 14000,
      icon: "VOID",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.length === 6 && ctx.letters.every((char) => "QXZJ".includes(char)),
    },
    {
      id: "quartz_crown",
      name: "Quartz Crown",
      description: "Q, X, and Z all appear together with no vowels.",
      rarity: "mythic",
      value: 5600,
      icon: "QXZ",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.includes("Q") && ctx.sequence.includes("X") && ctx.sequence.includes("Z") && ctx.vowelCount === 0,
    },
    {
      id: "vowel_singularity_6",
      name: "Vowel Singularity",
      description: "All 6 alphabet tiles are vowels.",
      rarity: "mythic",
      value: 6800,
      icon: "V6",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.length === 6 && ctx.vowelCount === 6,
    },
    {
      id: "prime_letter_crown",
      name: "Prime Letter Crown",
      description: "Every alphabet tile lands on a prime alphabet position.",
      rarity: "legendary",
      value: 3200,
      icon: "P6",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.length === 6 && ctx.letters.every((char) => [2, 3, 5, 7, 11, 13, 17, 19, 23].includes(getAlphabetPosition(char))),
    },
    {
      id: "fibonacci_crown",
      name: "Fibonacci Crown",
      description: "Every alphabet tile lands on a Fibonacci alphabet position.",
      rarity: "mythic",
      value: 9000,
      icon: "FIB",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.length === 6 && ctx.letters.every((char) => [1, 2, 3, 5, 8, 13, 21].includes(getAlphabetPosition(char))),
    },
    {
      id: "golden_sigma",
      name: "Golden Sigma",
      description: "The alphabet-position total equals exactly 137.",
      rarity: "legendary",
      value: 2600,
      icon: "S137",
      rollMode: "letters",
      condition: (ctx) => ctx.alphaScore === 137,
    },
    {
      id: "perfect_sigma",
      name: "Perfect Sigma",
      description: "The alphabet-position total equals exactly 123.",
      rarity: "legendary",
      value: 2400,
      icon: "S123",
      rollMode: "letters",
      condition: (ctx) => ctx.alphaScore === 123,
    },
    {
      id: "alpha_exact",
      name: "Alpha Relic",
      description: "The alphabet lane rolls the exact word ALPHA.",
      rarity: "mythic",
      value: 14000,
      icon: "AL",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence === "ALPHA",
    },
    {
      id: "glyph_exact",
      name: "Glyph Relic",
      description: "The alphabet lane rolls the exact word GLYPH.",
      rarity: "mythic",
      value: 16000,
      icon: "GL",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence === "GLYPH",
    },
    {
      id: "gemini_exact",
      name: "Gemini Relic",
      description: "The alphabet lane rolls GEMINI exactly.",
      rarity: "glitched",
      value: 42000,
      icon: "AI6",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence === "GEMINI",
    },
    {
      id: "oracle_exact",
      name: "Oracle Relic",
      description: "The alphabet lane rolls ORACLE exactly.",
      rarity: "glitched",
      value: 38000,
      icon: "OR6",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence === "ORACLE",
    },
    {
      id: "cosmic_exact",
      name: "Cosmic Relic",
      description: "The alphabet lane rolls COSMIC exactly.",
      rarity: "glitched",
      value: 38000,
      icon: "CO6",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence === "COSMIC",
    },
    {
      id: "mythic_exact",
      name: "Mythic Relic",
      description: "The alphabet lane rolls MYTHIC exactly.",
      rarity: "glitched",
      value: 40000,
      icon: "MY6",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence === "MYTHIC",
    },
    {
      id: "full_word_oracle",
      name: "Full Word Oracle",
      description: "A full 6-letter sequence is recognized as a complete word.",
      rarity: "mythic",
      value: 8200,
      icon: "W6",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.length === 6 && ctx.fullSequenceWord,
    },
    {
      id: "gemini_oracle_word",
      name: "Gemini Oracle Word",
      description: "Gemini confirms a word that fills the entire 6-letter alphabet lane.",
      rarity: "glitched",
      value: 18000,
      icon: "AIW",
      rollMode: "letters",
      condition: (ctx) => ctx.sequence.length === 6 && ctx.words.some((word) => word.source === "gemini" && Number(word.start) === 0 && Number(word.length || word.word?.length || 0) === 6),
    },
    {
      id: "cosmic_jackpot",
      name: "Cosmic Jackpot",
      description: "A tiny luck-touched pulse erupts after the alphabet roll.",
      rarity: "mythic",
      value: 10000,
      icon: "CJ",
      rollMode: "letters",
      condition: (ctx) => ctx.cosmicPulse,
    },
    {
      id: "reality_rift",
      name: "Reality Rift",
      description: "A nearly impossible rift tears open behind the alphabet tiles.",
      rarity: "glitched",
      value: 45000,
      icon: "RIFT",
      rollMode: "letters",
      condition: (ctx) => ctx.realityRift,
    },
    {
      id: "abyssal_jackpot",
      name: "Abyssal Jackpot",
      description: "The chamber briefly breaks reality. Absurdly rare. Absurdly valuable.",
      rarity: "glitched",
      value: 120000,
      icon: "ABY",
      rollMode: "letters",
      condition: (ctx) => ctx.abyssalJackpot,
    },
    {
      id: "digit_twins",
      name: "Digit Twins",
      description: "The number lane starts small but lands two matching digits.",
      rarity: "uncommon",
      value: 0,
      numberMultiplier: 0.07,
      icon: "##",
      rollMode: "numbers",
      condition: (ctx) => ctx.numberCount === 2 && ctx.maxCount === 2,
    },
    {
      id: "chrono_30",
      name: "Chrono Thirty",
      description: "The number lane contains 30.",
      rarity: "common",
      value: 0,
      numberMultiplier: 0.05,
      icon: "30",
      rollMode: "numbers",
      condition: (ctx) => ctx.sequence.includes("30"),
    },
    {
      id: "area_51",
      name: "Area 51",
      description: "The number lane contains 51.",
      rarity: "common",
      value: 0,
      numberMultiplier: 0.06,
      icon: "51",
      rollMode: "numbers",
      condition: (ctx) => ctx.sequence.includes("51"),
    },
    {
      id: "forty_two_gate",
      name: "Forty-Two Gate",
      description: "The number lane contains 42.",
      rarity: "uncommon",
      value: 0,
      numberMultiplier: 0.08,
      icon: "42",
      rollMode: "numbers",
      condition: (ctx) => ctx.sequence.includes("42"),
    },
    {
      id: "error_404",
      name: "Error 404",
      description: "The number lane contains 404.",
      rarity: "rare",
      value: 0,
      numberMultiplier: 0.12,
      icon: "404",
      rollMode: "numbers",
      condition: (ctx) => ctx.sequence.includes("404"),
    },
    {
      id: "prime_chain_2357",
      name: "Prime Chain",
      description: "The number lane contains 2357.",
      rarity: "epic",
      value: 0,
      numberMultiplier: 0.24,
      icon: "2357",
      rollMode: "numbers",
      condition: (ctx) => ctx.sequence.includes("2357"),
    },
    {
      id: "golden_ratio",
      name: "Golden Ratio",
      description: "The number lane contains 1618.",
      rarity: "epic",
      value: 0,
      numberMultiplier: 0.28,
      icon: "1618",
      rollMode: "numbers",
      condition: (ctx) => ctx.sequence.includes("1618"),
    },
    {
      id: "six_digit_palindrome",
      name: "Six-Digit Mirror",
      description: "A 6-digit number lane mirrors perfectly.",
      rarity: "legendary",
      value: 0,
      numberMultiplier: 0.3,
      icon: "6#M",
      rollMode: "numbers",
      condition: (ctx) => ctx.numberCount === 6 && ctx.sequence === reverseString(ctx.sequence),
    },
    {
      id: "same_digit_six",
      name: "Digit Singularity",
      description: "All 6 number tiles are the same digit.",
      rarity: "mythic",
      value: 0,
      numberMultiplier: 0.9,
      icon: "6#X",
      rollMode: "numbers",
      condition: (ctx) => ctx.numberCount === 6 && ctx.maxCount === 6,
    },
    {
      id: "ascending_digit_relic",
      name: "Ascending Digit Relic",
      description: "The number lane rolls a full 6-digit ascending straight.",
      rarity: "mythic",
      value: 0,
      numberMultiplier: 0.55,
      icon: "012",
      rollMode: "numbers",
      condition: (ctx) => /012345|123456|234567|345678|456789/.test(ctx.sequence),
    },
    {
      id: "descending_digit_relic",
      name: "Descending Digit Relic",
      description: "The number lane rolls a full 6-digit descending straight.",
      rarity: "mythic",
      value: 0,
      numberMultiplier: 0.55,
      icon: "987",
      rollMode: "numbers",
      condition: (ctx) => /987654|876543|765432|654321|543210/.test(ctx.sequence),
    },
    {
      id: "binary_alternator",
      name: "Binary Alternator",
      description: "The number lane rolls 101010 or 010101.",
      rarity: "mythic",
      value: 0,
      numberMultiplier: 0.45,
      icon: "1010",
      rollMode: "numbers",
      condition: (ctx) => ctx.sequence === "101010" || ctx.sequence === "010101",
    },
    {
      id: "pi_relic",
      name: "Pi Relic",
      description: "The number lane rolls 314159 exactly.",
      rarity: "glitched",
      value: 0,
      numberMultiplier: 1.1,
      icon: "PI",
      rollMode: "numbers",
      condition: (ctx) => ctx.sequence === "314159",
    },
    {
      id: "euler_relic",
      name: "Euler Relic",
      description: "The number lane rolls 271828 exactly.",
      rarity: "glitched",
      value: 0,
      numberMultiplier: 1.1,
      icon: "E",
      rollMode: "numbers",
      condition: (ctx) => ctx.sequence === "271828",
    },
    {
      id: "void_000000",
      name: "Void 000000",
      description: "The number lane rolls six zeroes.",
      rarity: "glitched",
      value: 0,
      numberMultiplier: 1.4,
      icon: "000",
      rollMode: "numbers",
      condition: (ctx) => ctx.sequence === "000000",
    },
    {
      id: "heaven_777777",
      name: "Heaven 777777",
      description: "The number lane rolls six sevens.",
      rarity: "glitched",
      value: 0,
      numberMultiplier: 1.5,
      icon: "777",
      rollMode: "numbers",
      condition: (ctx) => ctx.sequence === "777777",
    },
    {
      id: "fives_555555",
      name: "Fivefold Vault",
      description: "The number lane rolls six fives.",
      rarity: "glitched",
      value: 0,
      numberMultiplier: 1.25,
      icon: "555",
      rollMode: "numbers",
      condition: (ctx) => ctx.sequence === "555555",
    },
    {
      id: "checksum_36",
      name: "Checksum 36",
      description: "The digit sum equals exactly 36.",
      rarity: "epic",
      value: 0,
      numberMultiplier: 0.18,
      icon: "S36",
      rollMode: "numbers",
      condition: (ctx) => ctx.digitSum === 36,
    },
    {
      id: "checksum_45",
      name: "Checksum 45",
      description: "The digit sum equals exactly 45.",
      rarity: "legendary",
      value: 0,
      numberMultiplier: 0.36,
      icon: "S45",
      rollMode: "numbers",
      condition: (ctx) => ctx.digitSum === 45,
    }
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
    {
      id: "fragment_qu",
      fragment: "QU",
      name: "Quark Fragment",
      rarity: "rare",
      value: 520,
      icon: "QU",
    },
    {
      id: "fragment_xz",
      fragment: "XZ",
      name: "X-Z Fragment",
      rarity: "epic",
      value: 940,
      icon: "XZ",
    },
    {
      id: "fragment_jq",
      fragment: "JQ",
      name: "J-Q Fragment",
      rarity: "epic",
      value: 980,
      icon: "JQ",
    },
    {
      id: "fragment_zq",
      fragment: "ZQ",
      name: "Z-Q Fragment",
      rarity: "epic",
      value: 1020,
      icon: "ZQ",
    },
    {
      id: "fragment_qx",
      fragment: "QX",
      name: "Q-X Fragment",
      rarity: "epic",
      value: 1040,
      icon: "QX",
    },
    {
      id: "fragment_aei",
      fragment: "AEI",
      name: "Vowel Prism",
      rarity: "legendary",
      value: 2300,
      icon: "AEI",
    },
    {
      id: "fragment_eio",
      fragment: "EIO",
      name: "Echo Prism",
      rarity: "legendary",
      value: 2300,
      icon: "EIO",
    },
    {
      id: "fragment_oua",
      fragment: "OUA",
      name: "Orbital Prism",
      rarity: "legendary",
      value: 2300,
      icon: "OUA",
    },
    {
      id: "fragment_rng",
      fragment: "RNG",
      name: "RNG Fragment",
      rarity: "mythic",
      value: 7600,
      icon: "RNG",
    },
    {
      id: "fragment_gem",
      fragment: "GEM",
      name: "Gem Fragment",
      rarity: "legendary",
      value: 2600,
      icon: "GEM",
    },
    {
      id: "fragment_ai",
      fragment: "AI",
      name: "AI Fragment",
      rarity: "rare",
      value: 720,
      icon: "AI",
    },
    {
      id: "fragment_zz",
      fragment: "ZZ",
      name: "Double Z Fragment",
      rarity: "epic",
      value: 1260,
      icon: "ZZ",
    },
    {
      id: "fragment_qq",
      fragment: "QQ",
      name: "Double Q Fragment",
      rarity: "epic",
      value: 1320,
      icon: "QQ",
    },
    {
      id: "fragment_xx",
      fragment: "XX",
      name: "Double X Fragment",
      rarity: "epic",
      value: 1260,
      icon: "XX",
    },
    {
      id: "fragment_jj",
      fragment: "JJ",
      name: "Double J Fragment",
      rarity: "epic",
      value: 1220,
      icon: "JJ",
    },
    {
      id: "fragment_abcde",
      fragment: "ABCDE",
      name: "Five-Step Ascension",
      rarity: "mythic",
      value: 8800,
      icon: "A-E",
    },
    {
      id: "fragment_vwxyz",
      fragment: "VWXYZ",
      name: "Five-Step Zenith",
      rarity: "mythic",
      value: 9000,
      icon: "V-Z",
    },
    {
      id: "fragment_cdefg",
      fragment: "CDEFG",
      name: "Chromatic Ladder",
      rarity: "mythic",
      value: 8400,
      icon: "C-G",
    },
    {
      id: "fragment_zyxwv",
      fragment: "ZYXWV",
      name: "Reverse Zenith",
      rarity: "mythic",
      value: 9100,
      icon: "Z-V",
    },
    {
      id: "fragment_myth",
      fragment: "MYTH",
      name: "Myth Fragment",
      rarity: "legendary",
      value: 3400,
      icon: "MYTH",
    },
    {
      id: "fragment_void",
      fragment: "VOID",
      name: "Void Fragment",
      rarity: "legendary",
      value: 3600,
      icon: "VOID",
    },
    {
      id: "fragment_luck",
      fragment: "LUCK",
      name: "Luck Fragment",
      rarity: "legendary",
      value: 3800,
      icon: "LUCK",
    },
    {
      id: "fragment_roll",
      fragment: "ROLL",
      name: "Roll Fragment",
      rarity: "legendary",
      value: 3200,
      icon: "ROLL",
    },
    {
      id: "fragment_blue",
      fragment: "BLUE",
      name: "Blue Fragment",
      rarity: "legendary",
      value: 3000,
      icon: "BLUE",
    },
    {
      id: "fragment_glow",
      fragment: "GLOW",
      name: "Glow Fragment",
      rarity: "legendary",
      value: 3300,
      icon: "GLOW",
    },
    {
      id: "fragment_core",
      fragment: "CORE",
      name: "Core Fragment",
      rarity: "legendary",
      value: 3400,
      icon: "CORE",
    },
    {
      id: "fragment_star",
      fragment: "STAR",
      name: "Star Fragment",
      rarity: "legendary",
      value: 3500,
      icon: "STAR",
    },
    {
      id: "fragment_moon",
      fragment: "MOON",
      name: "Moon Fragment",
      rarity: "legendary",
      value: 3500,
      icon: "MOON",
    },
    {
      id: "fragment_sun",
      fragment: "SUN",
      name: "Sun Fragment",
      rarity: "epic",
      value: 1600,
      icon: "SUN",
    },
    {
      id: "fragment_sky",
      fragment: "SKY",
      name: "Sky Fragment",
      rarity: "epic",
      value: 1550,
      icon: "SKY",
    },
  ];

  const MEGA_ALPHA_SIGMA_RELICS = [
    {
      id: "sigma_21",
      target: 21,
      rarity: "rare",
      value: 620,
    },
    {
      id: "sigma_34",
      target: 34,
      rarity: "rare",
      value: 680,
    },
    {
      id: "sigma_55",
      target: 55,
      rarity: "epic",
      value: 1250,
    },
    {
      id: "sigma_64",
      target: 64,
      rarity: "epic",
      value: 1320,
    },
    {
      id: "sigma_72",
      target: 72,
      rarity: "epic",
      value: 1380,
    },
    {
      id: "sigma_88",
      target: 88,
      rarity: "legendary",
      value: 2400,
    },
    {
      id: "sigma_99",
      target: 99,
      rarity: "legendary",
      value: 2600,
    },
    {
      id: "sigma_108",
      target: 108,
      rarity: "legendary",
      value: 2800,
    },
    {
      id: "sigma_123_mega",
      target: 123,
      rarity: "mythic",
      value: 7600,
    },
    {
      id: "sigma_144",
      target: 144,
      rarity: "mythic",
      value: 8200,
    },
    {
      id: "sigma_156",
      target: 156,
      rarity: "glitched",
      value: 32000,
    },
  ];

  const MEGA_NUMBER_CODE_RELICS = [
    {
      id: "mega_num_01",
      pattern: "01",
      mode: "contains",
      name: "Origin Code",
      rarity: "common",
      boost: 0.04,
      icon: "01",
    },
    {
      id: "mega_num_10",
      pattern: "10",
      mode: "contains",
      name: "Return Code",
      rarity: "common",
      boost: 0.04,
      icon: "10",
    },
    {
      id: "mega_num_12",
      pattern: "12",
      mode: "contains",
      name: "Step Code",
      rarity: "common",
      boost: 0.04,
      icon: "12",
    },
    {
      id: "mega_num_21",
      pattern: "21",
      mode: "contains",
      name: "Mirror Step Code",
      rarity: "common",
      boost: 0.04,
      icon: "21",
    },
    {
      id: "mega_num_23",
      pattern: "23",
      mode: "contains",
      name: "Prime Step Code",
      rarity: "common",
      boost: 0.05,
      icon: "23",
    },
    {
      id: "mega_num_32",
      pattern: "32",
      mode: "contains",
      name: "Reverse Prime Code",
      rarity: "common",
      boost: 0.05,
      icon: "32",
    },
    {
      id: "mega_num_45",
      pattern: "45",
      mode: "contains",
      name: "Lift Code",
      rarity: "common",
      boost: 0.05,
      icon: "45",
    },
    {
      id: "mega_num_54",
      pattern: "54",
      mode: "contains",
      name: "Drop Code",
      rarity: "common",
      boost: 0.05,
      icon: "54",
    },
    {
      id: "mega_num_89",
      pattern: "89",
      mode: "contains",
      name: "High Step Code",
      rarity: "uncommon",
      boost: 0.06,
      icon: "89",
    },
    {
      id: "mega_num_98",
      pattern: "98",
      mode: "contains",
      name: "Falling Step Code",
      rarity: "uncommon",
      boost: 0.06,
      icon: "98",
    },
    {
      id: "mega_num_007",
      pattern: "007",
      mode: "contains",
      name: "Agent Code",
      rarity: "rare",
      boost: 0.12,
      icon: "007",
    },
    {
      id: "mega_num_101",
      pattern: "101",
      mode: "contains",
      name: "Binary Door",
      rarity: "rare",
      boost: 0.1,
      icon: "101",
    },
    {
      id: "mega_num_111",
      pattern: "111",
      mode: "contains",
      name: "Triple One",
      rarity: "rare",
      boost: 0.12,
      icon: "111",
    },
    {
      id: "mega_num_222",
      pattern: "222",
      mode: "contains",
      name: "Triple Two",
      rarity: "rare",
      boost: 0.12,
      icon: "222",
    },
    {
      id: "mega_num_333",
      pattern: "333",
      mode: "contains",
      name: "Triple Three",
      rarity: "rare",
      boost: 0.12,
      icon: "333",
    },
    {
      id: "mega_num_444",
      pattern: "444",
      mode: "contains",
      name: "Triple Four",
      rarity: "rare",
      boost: 0.12,
      icon: "444",
    },
    {
      id: "mega_num_555",
      pattern: "555",
      mode: "contains",
      name: "Triple Five",
      rarity: "epic",
      boost: 0.16,
      icon: "555",
    },
    {
      id: "mega_num_666",
      pattern: "666",
      mode: "contains",
      name: "Triple Six",
      rarity: "epic",
      boost: 0.18,
      icon: "666",
    },
    {
      id: "mega_num_808",
      pattern: "808",
      mode: "contains",
      name: "Bass Gate",
      rarity: "rare",
      boost: 0.11,
      icon: "808",
    },
    {
      id: "mega_num_909",
      pattern: "909",
      mode: "contains",
      name: "Echo Gate",
      rarity: "rare",
      boost: 0.11,
      icon: "909",
    },
    {
      id: "mega_num_1337",
      pattern: "1337",
      mode: "contains",
      name: "Elite Code",
      rarity: "legendary",
      boost: 0.26,
      icon: "1337",
    },
    {
      id: "mega_num_2024",
      pattern: "2024",
      mode: "contains",
      name: "Archive 2024",
      rarity: "epic",
      boost: 0.2,
      icon: "2024",
    },
    {
      id: "mega_num_2025",
      pattern: "2025",
      mode: "contains",
      name: "Archive 2025",
      rarity: "epic",
      boost: 0.2,
      icon: "2025",
    },
    {
      id: "mega_num_2026",
      pattern: "2026",
      mode: "contains",
      name: "Archive 2026",
      rarity: "legendary",
      boost: 0.28,
      icon: "2026",
    },
    {
      id: "mega_num_2048",
      pattern: "2048",
      mode: "contains",
      name: "Power Code",
      rarity: "legendary",
      boost: 0.3,
      icon: "2048",
    },
    {
      id: "mega_num_4096",
      pattern: "4096",
      mode: "contains",
      name: "Deep Power Code",
      rarity: "legendary",
      boost: 0.32,
      icon: "4096",
    },
    {
      id: "mega_num_9001",
      pattern: "9001",
      mode: "contains",
      name: "Overlimit Code",
      rarity: "mythic",
      boost: 0.42,
      icon: "9001",
    },
    {
      id: "mega_num_1212",
      pattern: "1212",
      mode: "contains",
      name: "Twin Pulse",
      rarity: "epic",
      boost: 0.22,
      icon: "1212",
    },
    {
      id: "mega_num_3434",
      pattern: "3434",
      mode: "contains",
      name: "Double Ladder",
      rarity: "epic",
      boost: 0.22,
      icon: "3434",
    },
    {
      id: "mega_num_5656",
      pattern: "5656",
      mode: "contains",
      name: "Relay Ladder",
      rarity: "epic",
      boost: 0.22,
      icon: "5656",
    },
    {
      id: "mega_num_12345",
      pattern: "12345",
      mode: "exact",
      name: "Five-Step Digit Relic",
      rarity: "mythic",
      boost: 0.6,
      icon: "12345",
    },
    {
      id: "mega_num_54321",
      pattern: "54321",
      mode: "exact",
      name: "Reverse Five-Step Relic",
      rarity: "mythic",
      boost: 0.6,
      icon: "54321",
    },
    {
      id: "mega_num_13579",
      pattern: "13579",
      mode: "exact",
      name: "Odd Royal Flush",
      rarity: "mythic",
      boost: 0.65,
      icon: "13579",
    },
    {
      id: "mega_num_24680",
      pattern: "24680",
      mode: "exact",
      name: "Even Royal Flush",
      rarity: "mythic",
      boost: 0.65,
      icon: "24680",
    },
    {
      id: "mega_num_112358",
      pattern: "112358",
      mode: "exact",
      name: "True Fibonacci Relic",
      rarity: "glitched",
      boost: 1.3,
      icon: "FIB",
    },
    {
      id: "mega_num_161803",
      pattern: "161803",
      mode: "exact",
      name: "Golden Spiral Relic",
      rarity: "glitched",
      boost: 1.25,
      icon: "PHI",
    },
    {
      id: "mega_num_424242",
      pattern: "424242",
      mode: "exact",
      name: "Answer Echo",
      rarity: "glitched",
      boost: 1.2,
      icon: "42X",
    },
    {
      id: "mega_num_123456",
      pattern: "123456",
      mode: "exact",
      name: "Perfect Digit Ascent",
      rarity: "glitched",
      boost: 1.4,
      icon: "ASC",
    },
    {
      id: "mega_num_654321",
      pattern: "654321",
      mode: "exact",
      name: "Perfect Digit Descent",
      rarity: "glitched",
      boost: 1.4,
      icon: "DSC",
    },
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
    // Keep first paint fast. Exact probability formulas are resolved lazily
    // for earned/viewed badges so the game never freezes on startup.
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
    badge.dropChanceLabel = exactOdds ? formatProbabilityLabel(chance) : getNonPercentOddsLabel(badge);
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
      return getContainsAnyPatternChance([badge.pattern], length, NUMBERS);
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
      const alphabet = digitBadge ? NUMBERS : LETTERS;
      return getContainsAnyPatternChance(includePatterns, length, alphabet);
    }

    const literalPatterns = getLiteralPatternCandidates(badge, digitBadge);
    if (literalPatterns.length) {
      const alphabet = digitBadge ? NUMBERS : LETTERS;
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
    const alphabet = digitBadge ? NUMBERS : LETTERS;
    const derived = { luck: 0, rollMode: digitBadge ? "numbers" : "letters" };
    let hits = 0;

    for (let sample = 0; sample < samples; sample += 1) {
      const sequence = generateOddsSequence(alphabet, length, sample, digitBadge ? 131 : 67);
      const ctx = buildOddsContext(sequence, derived);
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
    return (PROBABILITY_RARITY_BANDS.find((band) => chance <= band.maxChance) || PROBABILITY_RARITY_BANDS.at(-1)).rarity;
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


  const DEFAULT_STATE = {
    version: 3,
    glyphs: 0,
    totalGlyphs: 0,
    totalRolls: 0,
    lastRollAt: 0,
    nextRollAt: 0,
    badges: {},
    upgrades: {},
    bestRoll: null,
    rarestBadgeId: null,
    lastResult: null,
    account: {
      signedIn: false,
      displayName: "Guest",
      email: "",
      isAdmin: false,
      twoStepVerified: false,
      csrfToken: "",
    },
    leaderboard: {
      localRows: [],
      boards: {},
      activeBoard: "daily",
      lastSyncAt: 0,
      lastSyncStatus: "Local demo mode",
    },
    settings: {
      sound: true,
      apiBase: "",
    },
  };

  const dom = {};
  let state = loadState();
  let activePage = "roll";
  let activeFilter = "all";
  let searchTerm = "";
  let rolling = false;
  let countdownInterval = null;
  let audioContext = null;
  let confettiAnimation = null;
  let confettiParticles = [];
  let pendingTwoStepCode = "";
  let leaderboardRows = [];
  let backendOnline = false;
  let backendHealth = null;
  let progressSaveTimer = null;
  let collectionSearchTimer = null;
  let lastToneAt = 0;
  let collectionRenderToken = 0;
  let cutsceneRenderToken = 0;
  const badgeOddsCache = new Map();
  let collapsedUpgradeSections = new Set(UPGRADE_SECTIONS.filter((section) => !section.defaultOpen).map((section) => section.id));

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheDom();
    document.body.classList.toggle("low-power-mode", LOW_POWER_MODE);
    bindEvents();
    handleAuthRedirectNotice();
    activePage = getPageFromHash() || "roll";
    showPage(activePage, false);
    startCountdown();

    if (state.lastResult) {
      renderLastResult(state.lastResult);
      renderTiles(state.lastResult, state.lastResult.glowingIndexes || []);
      dom.sequencePrompt.textContent = `Last signal: ${formatRollSequence(state.lastResult)}`;
    } else {
      renderPlaceholderTiles();
    }

    scheduleBackgroundTask(bootstrapBackend, 350);
  }

  function scheduleBackgroundTask(callback, fallbackDelay = 0) {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(callback, { timeout: 2500 });
      return;
    }
    setTimeout(callback, fallbackDelay);
  }

  async function bootstrapBackend() {
    const online = await refreshBackendStatus();
    if (online) await hydrateBackendSession();
    renderHeader();
    renderActivePage();
  }

  function cacheDom() {
    const ids = [
      "confettiCanvas",
      "headerGlyphs",
      "headerLuck",
      "headerAccountName",
      "accountPill",
      "soundToggle",
      "navBadgeCount",
      "modeChip",
      "rollConsole",
      "readyStatus",
      "cooldownLabel",
      "sequenceStage",
      "tileRow",
      "sequencePrompt",
      "rollModeSwitch",
      "letterModeButton",
      "numberModeButton",
      "rollButton",
      "adminCutscenePreview",
      "rollButtonHint",
      "countdownWrap",
      "countdownTimer",
      "timerProgress",
      "consoleLuck",
      "consoleAlphaBoost",
      "resultCard",
      "emptyResult",
      "resultContent",
      "resultTier",
      "resultTime",
      "resultRollDisplay",
      "resultAlphaGlyphs",
      "resultDigitMultiplier",
      "resultFinalGlyphs",
      "resultFormula",
      "wordFind",
      "wordChips",
      "earnedCount",
      "earnedList",
      "shareButton",
      "quickRolls",
      "quickBest",
      "nextGoalTitle",
      "nextGoalHint",
      "nextGoalProgress",
      "nextGoalMeta",
      "liveSyncTitle",
      "liveSyncHint",
      "collectionProgressText",
      "collectionRing",
      "collectionPercent",
      "badgeGrid",
      "badgeSearch",
      "cutsceneProgressText",
      "cutsceneRing",
      "cutscenePercent",
      "cutsceneIndexGrid",
      "forgeGlyphs",
      "upgradeTree",
      "upgradeGrid",
      "statRolls",
      "statGlyphs",
      "statLuck",
      "statBadges",
      "statBadgePercent",
      "bestTier",
      "bestSequence",
      "bestValue",
      "bestBadges",
      "rarestDisplay",
      "upgradeCount",
      "upgradeProgress",
      "upgradeProgressHint",
      "statNextRoll",
      "statNextHint",
      "leaderboardMode",
      "leaderboardStatus",
      "leaderboardSyncButton",
      "leaderboardTabs",
      "leaderboardMetricHead",
      "leaderboardRows",
      "accountState",
      "authForm",
      "authModeText",
      "displayNameInput",
      "emailInput",
      "passwordInput",
      "authPasswordHelp",
      "twoStepInput",
      "sendCodeButton",
      "twoStepHint",
      "signInButton",
      "signOutButton",
      "apiBaseInput",
      "saveApiBaseButton",
      "integrationStatus",
      "leaderboardIntegrationStatus",
      "geminiStatus",
      "resetButton",
      "confirmModal",
      "cancelReset",
      "confirmReset",
      "badgeBurstLayer",
      "toastRegion",
    ];

    ids.forEach((id) => {
      dom[id] = document.getElementById(id);
    });

    dom.navButtons = Array.from(document.querySelectorAll("[data-page]"));
    dom.pageLinks = Array.from(document.querySelectorAll("[data-page-link]"));
    dom.pages = Array.from(document.querySelectorAll("[data-page-section]"));
    dom.filterTabs = Array.from(document.querySelectorAll("[data-filter]"));
    dom.leaderboardTabs = Array.from(document.querySelectorAll("[data-leaderboard-board]"));
  }

  function bindEvents() {
    dom.navButtons.forEach((button) => {
      button.addEventListener("click", () => showPage(button.dataset.page));
    });

    dom.pageLinks.forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        showPage(link.dataset.pageLink);
      });
    });

    window.addEventListener("hashchange", () => {
      const page = getPageFromHash();
      if (page) showPage(page, false);
    });

    dom.rollButton.addEventListener("click", rollSequence);
    dom.letterModeButton.addEventListener("click", () => setRollMode("letters"));
    dom.numberModeButton.addEventListener("click", () => setRollMode("numbers"));
    dom.adminCutscenePreview.addEventListener("click", previewAdminCutscene);
    dom.shareButton.addEventListener("click", shareLastRoll);
    dom.soundToggle.addEventListener("click", toggleSound);
    dom.leaderboardSyncButton.addEventListener("click", () => syncLeaderboard(true));
    dom.leaderboardTabs.forEach((button) => {
      button.addEventListener("click", () => {
        state.leaderboard.activeBoard = button.dataset.leaderboardBoard || "daily";
        saveState();
        renderLeaderboard();
      });
    });
    dom.sendCodeButton.addEventListener("click", sendTwoStepCode);
    dom.authForm.addEventListener("submit", signInPlayer);
    dom.signOutButton.addEventListener("click", signOutPlayer);
    dom.saveApiBaseButton.addEventListener("click", saveBackendUrl);
    dom.badgeSearch.addEventListener("input", () => {
      searchTerm = dom.badgeSearch.value.trim().toLowerCase();
      clearTimeout(collectionSearchTimer);
      collectionSearchTimer = setTimeout(renderCollection, LOW_POWER_MODE ? 180 : 90);
    });

    dom.filterTabs.forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.filter;
        dom.filterTabs.forEach((tab) => tab.classList.toggle("active", tab === button));
        renderCollection();
      });
    });

    dom.resetButton.addEventListener("click", () => {
      dom.confirmModal.classList.remove("hidden");
    });

    dom.cancelReset.addEventListener("click", () => {
      dom.confirmModal.classList.add("hidden");
    });

    dom.confirmModal.addEventListener("click", (event) => {
      if (event.target === dom.confirmModal) {
        dom.confirmModal.classList.add("hidden");
      }
    });

    dom.confirmReset.addEventListener("click", () => {
      localStorage.removeItem(SAVE_KEY);
      state = cloneDefaultState();
      pendingTwoStepCode = "";
      dom.confirmModal.classList.add("hidden");
      renderPlaceholderTiles();
      renderAll();
      renderEmptyResult();
      showToast("Local save reset.");
    });

    window.addEventListener("resize", resizeConfettiCanvas);
    resizeConfettiCanvas();
  }

  function showPage(page, pushHash = true) {
    if (!getPages().includes(page)) return;
    activePage = page;

    dom.pages.forEach((section) => {
      section.classList.toggle("active", section.dataset.pageSection === page);
    });

    dom.navButtons.forEach((button) => {
      const active = button.dataset.page === page;
      button.classList.toggle("active", active);
      if (active && button.closest(".sidebar")) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });

    if (pushHash && location.hash !== `#${page}`) {
      history.replaceState(null, "", `#${page}`);
    }

    renderHeader();
    renderActivePage();
  }

  function getPageFromHash() {
    const page = location.hash.replace("#", "");
    return getPages().includes(page) ? page : null;
  }

  function getPages() {
    return ["roll", "collection", "cutscenes", "upgrades", "stats", "leaderboard", "account"];
  }

  function setRollMode(mode) {
    playTone("tick");
    showToast("Alphabet and number dice now roll together. Digits multiply same-roll alphabet badge Glyphs.");
    renderRollPanel();
    renderPlaceholderTiles();
  }

  async function rollSequence() {
    if (rolling) return;

    const remaining = getRemainingMs();
    if (remaining > 0) {
      playTone("error");
      showToast(`The chamber is recharging: ${formatDuration(remaining)} left.`, "error");
      renderCooldown();
      return;
    }

    rolling = true;
    dom.rollButton.disabled = true;
    dom.rollConsole.classList.add("rolling");
    dom.sequencePrompt.textContent = "Alphabet dice and digit dice are tumbling together...";
    renderEmptyResult();
    playTone("roll");

    const derived = getDerivedStats();
    const roll = generateCombinedRoll(derived);
    const sequence = roll.sequence;
    const glowingIndexes = getGlowingIndexes(sequence.length, derived);
    const evaluationPromise = evaluateRoll(roll, derived, glowingIndexes);

    await animateRoll(roll, derived, glowingIndexes);

    dom.sequencePrompt.textContent = "Gemini is scanning words, badges, and rarity...";
    const result = await evaluationPromise;
    applyRollResult(result);
    syncLeaderboard(false, result);
    renderHeader();
    renderRollPanel();
    renderLastResult(result);
    celebrateBadges(result);

    dom.rollConsole.classList.remove("rolling");
    dom.sequencePrompt.textContent = `${formatRollSequence(result)} locked into the archive.`;
    rolling = false;
    dom.adminCutscenePreview.classList.toggle("hidden", !hasAdminPowers());
    renderCooldown();

    if (getTierRank(result.tier) >= getTierRank("rare")) {
      launchConfetti(result.tier);
      playTone("rare");
    } else {
      playTone("reward");
    }

    const badgeText = result.earnedBadges.length === 1 ? "badge" : "badges";
    const boostText = result.numberMultiplierBonus
      ? ` Digit boost ${formatLuck(result.numberMultiplier)}.`
      : "";
    showToast(`Rolled ${formatRollSequence(result)}: +${formatNumber(result.glyphsEarned)} Glyphs, ${result.earnedBadges.length} ${badgeText}.${boostText}`);
  }

  function generateCombinedRoll(derived) {
    const letterSequence = generateSequence(derived.sequenceLength, LETTERS);
    const numberSequence = generateSequence(derived.numberSequenceLength, NUMBERS);
    return {
      sequence: `${letterSequence}${numberSequence}`,
      letterSequence,
      numberSequence,
    };
  }

  function generateSequence(length, alphabet = LETTERS) {
    let output = "";
    for (let i = 0; i < length; i += 1) {
      output += randomChar(alphabet);
    }
    return output;
  }

  function getRollParts(roll) {
    const source = typeof roll === "string" ? { sequence: roll } : (roll || {});
    const combined = String(source.sequence || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const letterSequence = String(source.letterSequence || "").toUpperCase().replace(/[^A-Z]/g, "") ||
      [...combined].filter(isLetter).join("");
    const numberSequence = String(source.numberSequence || "").replace(/\D/g, "") ||
      [...combined].filter((char) => /\d/.test(char)).join("");
    return {
      sequence: `${letterSequence}${numberSequence}`,
      letterSequence,
      numberSequence,
    };
  }

  function formatRollSequence(roll) {
    const parts = getRollParts(roll);
    if (parts.letterSequence && parts.numberSequence) return `${parts.letterSequence} × ${parts.numberSequence}`;
    return parts.sequence || "—";
  }

  function isNumberBadge(badge) {
    return Boolean(Number(badge?.numberMultiplier || 0) > 0 || badge?.rollMode === "numbers" || badge?.requiresMixed);
  }

  async function evaluateRoll(roll, derived, glowingIndexes) {
    const parts = getRollParts(roll);
    const backendResult = await evaluateRollWithBackend(parts, derived, glowingIndexes);
    if (backendResult) return backendResult;

    const letterCtx = await buildRollContext(parts.letterSequence, { ...derived, rollMode: "letters" });
    const numberCtx = await buildRollContext(parts.numberSequence, { ...derived, rollMode: "numbers" });
    const alphabetBadges = BADGES.filter((badge) => !isNumberBadge(badge) && isBadgeAvailableForRoll(badge, derived) && badge.condition(letterCtx));
    const numberBadges = BADGES.filter((badge) => isNumberBadge(badge) && isBadgeAvailableForRoll(badge, derived) && badge.condition(numberCtx));
    const earnedBadges = [...alphabetBadges, ...numberBadges];
    earnedBadges.forEach(ensureBadgeEconomy);
    const badgeGlyphsRaw = alphabetBadges.reduce((sum, badge) => sum + Math.floor(badge.value * getBadgeValueMultiplier(badge, derived, letterCtx)), 0);
    const alphabetBadgeGlyphs = Math.floor(badgeGlyphsRaw * derived.badgeMultiplier);
    const numberMultiplierBonus = numberBadges.reduce((sum, badge) => sum + Number(badge.numberMultiplier || 0), 0) * (derived.numberBadgeMultiplier || 1);
    const numberMultiplier = 1 + numberMultiplierBonus;
    const badgeGlyphsBoosted = Math.floor(alphabetBadgeGlyphs * numberMultiplier);
    const newlyDiscovered = earnedBadges.filter((badge) => !state.badges[badge.id]);
    const newlyDiscoveredAlphabet = alphabetBadges.filter((badge) => !state.badges[badge.id]);
    const autoClaimBonus = derived.autoClaim ? newlyDiscoveredAlphabet.length * derived.autoClaimBonus : 0;
    const rawGlyphs = BASE_GLYPHS + badgeGlyphsBoosted * derived.luck + autoClaimBonus;
    const glyphsEarned = Math.max(
      BASE_GLYPHS,
      Math.floor(rawGlyphs * (derived.glyphMultiplier || 1))
    );
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
      words: letterCtx.words,
      earnedBadges: earnedBadges.map((badge) => ({
        id: badge.id,
        name: badge.name,
        description: badge.description,
        rarity: badge.rarity,
        value: isNumberBadge(badge) ? 0 : badge.value,
        numberMultiplier: Number(badge.numberMultiplier || 0),
        icon: badge.icon,
        isNew: !state.badges[badge.id],
      })),
      glowingIndexes,
    };
  }

  async function evaluateRollWithBackend(roll, derived, glowingIndexes) {
    const apiBase = getBackendUrl();
    if (!apiBase) return null;
    const parts = getRollParts(roll);

    try {
      const response = await safeFetch(buildApiUrl(apiBase, "/evaluate-roll"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        timeoutMs: 9000,
        body: JSON.stringify({
          sequence: parts.sequence,
          letterSequence: parts.letterSequence,
          numberSequence: parts.numberSequence,
          derived,
          knownBadgeIds: Object.keys(state.badges || {}),
        }),
      });

      if (!response.ok) throw new Error(`Roll evaluation returned ${response.status}`);
      const payload = await response.json();
      return {
        sequence: payload.sequence || parts.sequence,
        letterSequence: payload.letterSequence || parts.letterSequence,
        numberSequence: payload.numberSequence || parts.numberSequence,
        glyphsEarned: Number(payload.glyphsEarned) || BASE_GLYPHS,
        baseGlyphs: Number(payload.baseGlyphs) || BASE_GLYPHS,
        badgeGlyphs: Number(payload.badgeGlyphs) || 0,
        alphabetBadgeGlyphs: Number(payload.alphabetBadgeGlyphs) || 0,
        badgeGlyphsBoosted: Number(payload.badgeGlyphsBoosted) || 0,
        autoClaimBonus: Number(payload.autoClaimBonus) || 0,
        numberMultiplier: Number(payload.numberMultiplier) || 1,
        numberMultiplierBonus: Number(payload.numberMultiplierBonus) || 0,
        numberBoostEarned: Number(payload.numberBoostEarned) || 0,
        rollMode: "combo",
        tier: TIER_ORDER.includes(payload.tier) ? payload.tier : "common",
        at: Number(payload.at) || Date.now(),
        words: Array.isArray(payload.words) ? payload.words : [],
        earnedBadges: (Array.isArray(payload.earnedBadges) ? payload.earnedBadges : []).map((badge) => ({
          id: badge.id,
          name: badge.name,
          description: badge.description,
          rarity: badge.rarity,
          value: Number(badge.value) || 0,
          numberMultiplier: Number(badge.numberMultiplier) || 0,
          icon: badge.icon || "◆",
          isNew: !state.badges[badge.id],
        })),
        glowingIndexes,
        geminiUsed: Boolean(payload.geminiUsed),
      };
    } catch (error) {
      console.warn("Live backend roll evaluation unavailable; using local fallback.", error);
      return null;
    }
  }

  function applyRollResult(result) {
    const derived = getDerivedStats();
    const now = Date.now();
    state.totalRolls += 1;
    state.glyphs += result.glyphsEarned;
    state.totalGlyphs += result.glyphsEarned;
    state.lastRollAt = now;
    state.nextRollAt = now + derived.normalCooldownMs;

    state.lastResult = result;

    const sortedEarnedBadges = [
      ...sortBadgesWorstToBest(result.earnedBadges.filter((badge) => !isNumberBadge(badge))),
      ...sortBadgesWorstToBest(result.earnedBadges.filter(isNumberBadge)),
    ];

    sortedEarnedBadges.forEach((earned) => {
      const existing = state.badges[earned.id] || {
        count: 0,
        firstAt: now,
        bestRoll: null,
      };

      existing.count += 1;
      if (!existing.bestRoll || result.glyphsEarned > existing.bestRoll.glyphsEarned) {
        existing.bestRoll = {
          sequence: result.sequence,
          letterSequence: result.letterSequence,
          numberSequence: result.numberSequence,
          glyphsEarned: result.glyphsEarned,
          tier: result.tier,
          at: now,
        };
      }

      state.badges[earned.id] = existing;
    });

    if (!state.bestRoll || result.glyphsEarned > state.bestRoll.glyphsEarned) {
      state.bestRoll = {
        sequence: result.sequence,
        letterSequence: result.letterSequence,
        numberSequence: result.numberSequence,
        glyphsEarned: result.glyphsEarned,
        tier: result.tier,
        badgeCount: result.earnedBadges.length,
        at: now,
      };
    }

    state.rarestBadgeId = getRarestBadgeId();
    saveState();
  }

  async function buildRollContext(sequence, derived) {
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
    const pairCount = values.filter((count) => count >= 2).length;
    const exactPairCount = values.filter((count) => count === 2).length;
    const alphaScore = letters.reduce((sum, char) => sum + getAlphabetPosition(char), 0);
    const highCount = letters.filter((char) => getAlphabetPosition(char) >= 14).length;
    const lowCount = letters.filter((char) => getAlphabetPosition(char) <= 13).length;
    const rollMode = derived.rollMode === "numbers" ? "numbers" : "letters";
    const localWords = rollMode === "numbers" ? [] : findWords(sequence);
    const words = await getWordDetections(sequence, localWords);
    const longestWordLength = words.reduce((max, word) => Math.max(max, Number(word.length || word.word?.length || 0)), 0);
    const glitchedChance = Math.min(0.03, 0.0015 * derived.luck + (derived.glitchChanceBonus || 0));
    const luckSurgeChance = Math.min(0.1, 0.018 * derived.luck + (derived.luckSurgeBonus || 0));
    const cosmicPulseChance = Math.min(0.006, 0.00035 * derived.luck + (derived.glitchChanceBonus || 0) * 0.04);
    const realityRiftChance = Math.min(0.0015, 0.00006 * derived.luck + (derived.glitchChanceBonus || 0) * 0.012);
    const abyssalJackpotChance = Math.min(0.00035, 0.000012 * derived.luck + (derived.glitchChanceBonus || 0) * 0.003);

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
      pairCount,
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
      derived,
    };
  }

  function determineTier(earnedBadges, glyphsEarned) {
    if (earnedBadges.some((badge) => badge.rarity === "glitched")) return "glitched";

    const highestBadgeRank = earnedBadges.reduce((rank, badge) => {
      return Math.max(rank, RARITIES[badge.rarity]?.rank || 0);
    }, 0);

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

  function isBadgeAvailableForRoll(badge, derived) {
    return true;
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

  function findWords(sequence) {
    const found = new Map();
    for (let start = 0; start < sequence.length; start += 1) {
      for (let length = 4; length <= Math.min(9, sequence.length - start); length += 1) {
        const piece = sequence.slice(start, start + length);
        if (!/^[A-Z]+$/.test(piece)) continue;
        if (WORD_SET.has(piece) && !found.has(piece)) {
          found.set(piece, { word: piece, start, length });
        }
      }
    }
    return Array.from(found.values()).sort((a, b) => b.length - a.length || a.start - b.start);
  }

  async function getWordDetections(sequence, localWords) {
    if (!/^[A-Z]+$/.test(sequence)) return localWords;

    const apiBase = getBackendUrl();
    if (!apiBase) return localWords;

    try {
      const response = await safeFetch(buildApiUrl(apiBase, "/ai/words"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 7000,
        body: JSON.stringify({ provider: "gemini", sequence }),
      });

      if (!response.ok) throw new Error(`Gemini word endpoint returned ${response.status}`);
      const payload = await response.json();
      const aiWords = normalizeAiWords(payload.words || [], sequence);
      return mergeWordLists(localWords, aiWords);
    } catch (error) {
      console.warn("Gemini word detection unavailable; using local lexicon fallback.", error);
      return localWords;
    }
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

  function mergeWordLists(localWords, aiWords) {
    const merged = new Map();
    [...localWords, ...aiWords].forEach((entry) => {
      if (!merged.has(entry.word)) merged.set(entry.word, entry);
    });
    return Array.from(merged.values()).sort((a, b) => b.length - a.length || a.start - b.start);
  }

  async function animateRoll(roll, derived, glowingIndexes) {
    const parts = getRollParts(roll);
    const chars = [...parts.letterSequence, ...parts.numberSequence];
    const letterCount = parts.letterSequence.length;
    const tileElements = [];
    const lanes = createDiceLanes();
    dom.tileRow.classList.remove("roll-impact");
    dom.tileRow.classList.add("is-rolling");

    parts.letterSequence.split("").forEach((_, index) => {
      const tileClasses = ["shuffling"];
      const tile = createTile(randomChar(LETTERS), index, tileClasses);
      lanes.alphaTiles.appendChild(tile);
      tileElements.push(tile);
    });

    parts.numberSequence.split("").forEach((_, index) => {
      const tileClasses = ["shuffling", "number-tile"];
      const tile = createTile(randomChar(NUMBERS), index, tileClasses);
      lanes.numberTiles.appendChild(tile);
      tileElements.push(tile);
    });

    const shuffleTimer = setInterval(() => {
      tileElements.forEach((tile, index) => {
        if (tile.classList.contains("shuffling")) {
          const alphabet = index < letterCount ? LETTERS : NUMBERS;
          tile.textContent = randomChar(alphabet);
        }
      });
    }, LOW_POWER_MODE ? 96 : 72);

    try {
      await sleep(620);

      for (let index = 0; index < chars.length; index += 1) {
        const tile = tileElements[index];
        tile.classList.add("pre-reveal");
        dom.sequencePrompt.textContent = index < letterCount
          ? `Locking alphabet tile ${index + 1} of ${letterCount}...`
          : `Locking multiplier digit ${index - letterCount + 1} of ${parts.numberSequence.length}...`;
        await sleep(index === 0 ? 220 : 340);

        tile.className = `letter-tile revealing${index >= letterCount ? " number-tile" : ""}`;
        tile.dataset.index = index >= letterCount ? index - letterCount + 1 : index + 1;
        if (glowingIndexes.includes(index)) tile.classList.add("glowing", "jackpot");
        tile.textContent = chars[index];
        playTone(index === chars.length - 1 ? "reward" : "tick");

        await sleep(300);
      }
    } finally {
      clearInterval(shuffleTimer);
      dom.tileRow.classList.remove("is-rolling");
    }

    dom.sequencePrompt.textContent = "Sequence locked. Resolving badge signal...";
    dom.tileRow.classList.add("roll-impact");
    await sleep(520);
    dom.tileRow.classList.remove("roll-impact");
  }

  function createDiceLanes() {
    dom.tileRow.innerHTML = "";
    const alphaLane = document.createElement("div");
    const numberLane = document.createElement("div");
    const alphaLabel = document.createElement("span");
    const numberLabel = document.createElement("span");
    const alphaTiles = document.createElement("div");
    const numberTiles = document.createElement("div");

    alphaLane.className = "dice-lane alphabet-lane";
    numberLane.className = "dice-lane number-lane";
    alphaLabel.className = "dice-lane-label";
    numberLabel.className = "dice-lane-label";
    alphaTiles.className = "dice-lane-tiles";
    numberTiles.className = "dice-lane-tiles";
    alphaLabel.textContent = "Alphabet dice";
    numberLabel.textContent = "Multiplier dice";

    alphaLane.append(alphaLabel, alphaTiles);
    numberLane.append(numberLabel, numberTiles);
    dom.tileRow.append(alphaLane, numberLane);

    return { alphaTiles, numberTiles };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function renderAll() {
    renderHeader();
    renderActivePage();
  }

  function renderActivePage() {
    if (activePage === "roll") {
      renderRollPanel();
      return;
    }

    if (activePage === "collection") renderCollection();
    if (activePage === "cutscenes") renderCutsceneIndex();
    if (activePage === "upgrades") renderUpgrades();
    if (activePage === "stats") renderStats();
    if (activePage === "leaderboard") renderLeaderboard();
    if (activePage === "account") renderAccount();
  }

  function renderHeader() {
    const derived = getDerivedStats();
    const discovered = getDiscoveredBadges().length;
    dom.headerGlyphs.textContent = formatNumber(state.glyphs);
    dom.headerLuck.textContent = formatLuck(derived.luck);
    dom.headerAccountName.textContent = getPlayerName();
    dom.consoleLuck.textContent = formatLuck(derived.luck);
    dom.consoleAlphaBoost.textContent = formatLuck(state.lastResult?.numberMultiplier || 1);
    dom.navBadgeCount.textContent = discovered;
    dom.soundToggle.classList.toggle("sound-muted", !state.settings.sound);
    dom.soundToggle.setAttribute("aria-label", state.settings.sound ? "Turn sound off" : "Turn sound on");
    dom.soundToggle.title = state.settings.sound ? "Sound on" : "Sound off";
  }

  function renderRollPanel() {
    const derived = getDerivedStats();
    const rollLength = `${derived.sequenceLength} letters + ${derived.numberSequenceLength} digits`;
    dom.rollButtonHint.textContent = derived.adminCooldownBypass
      ? `Admin: unlimited ${rollLength}`
      : rollLength;
    dom.modeChip.classList.add("mixed");
    dom.modeChip.lastChild.textContent = " Dual Dice Engine";
    dom.letterModeButton.classList.add("active");
    dom.numberModeButton.classList.add("active");
    dom.numberModeButton.disabled = false;
    dom.numberModeButton.title = "Digits roll beside letters and multiply alphabet badge Glyphs.";
    dom.letterModeButton.title = "Alphabet badges create Glyphs directly.";
    dom.rollModeSwitch.dataset.activeMode = "combo";
    dom.rollModeSwitch.dataset.lockedNumbers = "false";
    dom.quickRolls.textContent = formatNumber(state.totalRolls);
    dom.adminCutscenePreview.classList.toggle("hidden", !hasAdminPowers());
    dom.quickBest.textContent = state.bestRoll ? `${formatNumber(state.bestRoll.glyphsEarned)} ◆` : "—";
    renderNextObjective();
    renderLiveSyncCard();
    renderCooldown();
  }

  function renderNextObjective() {
    if (!dom.nextGoalTitle) return;

    const discovered = getDiscoveredBadges().length;
    if (!state.totalRolls) {
      dom.nextGoalTitle.textContent = "Roll your first signal";
      dom.nextGoalHint.textContent = "Alphabet badges make Glyphs. Digit badges multiply that same roll.";
      dom.nextGoalProgress.style.width = "0%";
      dom.nextGoalMeta.textContent = "Ready to begin";
      return;
    }

    if (!discovered) {
      dom.nextGoalTitle.textContent = "Discover badge #1";
      dom.nextGoalHint.textContent = "Common badges pop fast. Look for pairs, rare letters, words, or clean digit boosts.";
      dom.nextGoalProgress.style.width = "12%";
      dom.nextGoalMeta.textContent = "Archive unopened";
      return;
    }

    const nextUpgrade = getNextObjectiveUpgrade();
    if (!nextUpgrade) {
      dom.nextGoalTitle.textContent = "Dice forge complete";
      dom.nextGoalHint.textContent = "All dice upgrades are online. Hunt rare badge cutscenes and leaderboard flexes.";
      dom.nextGoalProgress.style.width = "100%";
      dom.nextGoalMeta.textContent = "Max dice online";
      return;
    }

    const status = getUpgradeStatus(nextUpgrade);
    const progress = clamp(state.glyphs / Math.max(1, nextUpgrade.cost), 0, 1);
    dom.nextGoalTitle.textContent = nextUpgrade.name;
    dom.nextGoalHint.textContent = status === "locked"
      ? getUpgradeTooltip(nextUpgrade, status)
      : `${nextUpgrade.effect}. Need ${formatNumber(Math.max(0, nextUpgrade.cost - state.glyphs))} more Glyphs.`;
    dom.nextGoalProgress.style.width = `${Math.round(progress * 100)}%`;
    dom.nextGoalMeta.textContent = status === "available"
      ? "Ready to activate"
      : `${Math.round(progress * 100)}% funded`;
  }

  function getNextObjectiveUpgrade() {
    const remaining = UPGRADES.filter((upgrade) => !state.upgrades[upgrade.id]);
    if (!remaining.length) return null;

    return remaining
      .map((upgrade) => ({ upgrade, status: getUpgradeStatus(upgrade) }))
      .sort((a, b) => {
        const score = { available: 0, poor: 1, locked: 2, owned: 3 };
        return score[a.status] - score[b.status] || a.upgrade.cost - b.upgrade.cost;
      })[0].upgrade;
  }

  function renderLiveSyncCard() {
    if (!dom.liveSyncTitle) return;

    if (!getBackendUrl()) {
      dom.liveSyncTitle.textContent = "Local save active";
      dom.liveSyncHint.textContent = "You can play fully now. Email/global login can be configured later.";
      return;
    }

    if (state.account?.signedIn) {
      dom.liveSyncTitle.textContent = "Cloud account active";
      dom.liveSyncHint.textContent = "Progress and leaderboard identity are tied to this signed-in account.";
      return;
    }

    if (backendHealth?.emailConfigured) {
      dom.liveSyncTitle.textContent = "Global login ready";
      dom.liveSyncHint.textContent = "Sign in from Account when you want cloud saves and global boards.";
      return;
    }

    dom.liveSyncTitle.textContent = "Server live, email later";
    dom.liveSyncHint.textContent = "Gemini/server features can run now. Magic-link email can be added later.";
  }

  function renderCooldown() {
    const remaining = getRemainingMs();
    const ready = remaining <= 0;
    const derived = getDerivedStats();

    dom.rollButton.disabled = rolling || !ready;
    dom.readyStatus.classList.toggle("cooling", !ready);
    dom.readyStatus.querySelector("b").textContent = derived.adminCooldownBypass ? "ADMIN READY" : ready ? "ROLL READY" : "RECHARGING";
    dom.cooldownLabel.textContent = derived.adminCooldownBypass
      ? "Admin rolls unlocked — no cooldown"
      : ready ? "Next roll available now" : `Next roll in ${formatDuration(remaining)}`;
    dom.countdownWrap.classList.toggle("hidden", ready);
    dom.rollButton.classList.toggle("hidden", !ready && !rolling);

    if (ready) {
      dom.countdownTimer.textContent = "READY";
      dom.timerProgress.style.width = "0%";
    } else {
      dom.countdownTimer.textContent = formatDuration(remaining);
      const percentLeft = clamp((remaining / derived.cooldownMs) * 100, 0, 100);
      dom.timerProgress.style.width = `${percentLeft}%`;
    }

    if (!rolling && ready) {
      dom.rollButton.classList.remove("hidden");
    }
  }

  function renderCollection() {
    collectionRenderToken += 1;
    const discovered = getDiscoveredBadges();
    const discoveredIds = new Set(discovered.map((badge) => badge.id));
    const progress = BADGES.length ? discovered.length / BADGES.length : 0;

    dom.collectionProgressText.textContent = `${discovered.length} / ${BADGES.length}`;
    dom.collectionPercent.textContent = `${Math.round(progress * 100)}%`;
    dom.collectionRing.style.setProperty("--progress", `${Math.round(progress * 360)}deg`);

    if (activePage !== "collection") {
      dom.badgeGrid.innerHTML = "";
      return;
    }

    const visibleBadges = BADGES.filter((badge) => {
      const unlocked = discoveredIds.has(badge.id);
      if (activeFilter === "unlocked" && !unlocked) return false;
      if (activeFilter === "locked" && unlocked) return false;
      if (!searchTerm) return true;

      const haystack = `${badge.name} ${badge.description} ${badge.rarity}`.toLowerCase();
      return haystack.includes(searchTerm);
    });

    dom.badgeGrid.innerHTML = "";

    if (!visibleBadges.length) {
      const empty = document.createElement("div");
      empty.className = "no-grid-results";
      empty.textContent = "No badges match that filter.";
      dom.badgeGrid.appendChild(empty);
      return;
    }

    renderBadgeGridBatched(visibleBadges, discoveredIds, collectionRenderToken);
  }

  function renderBadgeGridBatched(visibleBadges, discoveredIds, token) {
    const batchSize = LOW_POWER_MODE ? 12 : 24;
    let index = 0;

    const progressNode = document.createElement("div");
    progressNode.className = "grid-progress-note";

    const renderBatch = () => {
      if (token !== collectionRenderToken || activePage !== "collection") return;

      const fragment = document.createDocumentFragment();
      const end = Math.min(index + batchSize, visibleBadges.length);
      for (; index < end; index += 1) {
        const badge = visibleBadges[index];
        fragment.appendChild(createBadgeCard(badge, discoveredIds.has(badge.id)));
      }

      if (progressNode.isConnected) progressNode.remove();
      dom.badgeGrid.appendChild(fragment);

      if (index < visibleBadges.length) {
        progressNode.textContent = `Loading badge archive ${index} / ${visibleBadges.length}...`;
        dom.badgeGrid.appendChild(progressNode);
        scheduleBackgroundTask(renderBatch, 16);
      }
    };

    renderBatch();
  }

  function createBadgeCard(badge, unlocked) {
    const rarity = RARITIES[badge.rarity] || RARITIES.common;
    const info = state.badges[badge.id];
    const card = document.createElement("article");
    card.className = `badge-card${unlocked ? "" : " locked"}`;
    card.style.setProperty("--badge-color", rarity.color);
    card.style.setProperty("--badge-soft", rarity.soft);
    const isDigitBadge = isNumberBadge(badge);
    const badgeValueText = isDigitBadge ? "Multiplier only" : `${formatNumber(badge.value)} Glyphs`;
    const alphaBoostText = badge.numberMultiplier
      ? ` · +${Number(badge.numberMultiplier).toFixed(2)}x Alpha boost`
      : "";

    const lockedHint = "Undiscovered";
    const multiplierText = badge.numberMultiplier
      ? ` · ×${(1 + Number(badge.numberMultiplier)).toFixed(2)} number boost`
      : "";

    card.innerHTML = `
      <div class="badge-top">
        <div class="badge-emblem">${escapeHtml(badge.icon)}</div>
        <span class="badge-rarity">${rarity.label}</span>
      </div>
      <h3>${escapeHtml(unlocked ? badge.name : lockedHint)}</h3>
      <p>${escapeHtml(unlocked ? badge.description : "Roll more sequences to reveal this badge.")}</p>
      ${alphaBoostText ? `<div class="badge-value alpha-boost-value"><i>#</i>${escapeHtml(alphaBoostText)}</div>` : ""}
      ${isDigitBadge ? `<div class="badge-value"><i>#</i>${escapeHtml(badgeValueText)}</div>` : ""}
      <div class="badge-value"><i>◆</i>${formatNumber(badge.value)} Glyphs</div>
      <div class="badge-value"><i>%</i>${badge.dropChanceExact ? "Best of shown lengths" : "Odds"}: ${escapeHtml(badge.dropChanceLabel || "Complex rule")}</div>
      ${renderBadgeOdds(badge)}
      <div class="badge-history">
        <span>Earned <b>${unlocked ? formatNumber(info.count) : "0"}</b></span>
        <span>Best <b>${unlocked && info.bestRoll ? escapeHtml(formatRollSequence(info.bestRoll)) : "—"}</b></span>
      </div>
    `;

    if (isDigitBadge) {
      Array.from(card.querySelectorAll(".badge-value"))
        .filter((node) => node.textContent.includes("Glyphs"))
        .forEach((node) => node.remove());
    }

    return card;
  }

  function renderBadgeOdds(badge) {
    const digitBadge = isNumberBadge(badge);
    const cacheKey = `${badge.id}:${digitBadge ? "D" : "L"}`;
    if (badgeOddsCache.has(cacheKey)) return badgeOddsCache.get(cacheKey);
    const lengths = digitBadge ? [2, 3, 4, 6] : [4, 5, 6];
    const title = digitBadge ? "DIGIT ODDS" : "LETTER ODDS";
    const chips = lengths
      .map((length) => {
        const label = digitBadge ? `${length}D` : `${length}L`;
        return `<span><b>${label}</b>${escapeHtml(getBadgeOddsLabel(badge, length, digitBadge))}</span>`;
      })
      .join("");
    const html = `<div class="badge-odds"><small>${title}</small><div>${chips}</div></div>`;
    badgeOddsCache.set(cacheKey, html);
    return html;
  }

  function getBadgeOddsLabel(badge, length, digitBadge) {
    const formulaChance = getFormulaBadgeDropChanceForLength(badge, length, digitBadge);
    if (formulaChance !== null) return formulaChance > 0 ? formatProbabilityLabel(formulaChance) : "0%";
    const formulaOdds = getFormulaBadgeOddsLabel(badge, length, digitBadge);
    if (formulaOdds) return formulaOdds;
    return getNonPercentOddsLabel(badge);
  }

  function getFormulaBadgeOddsLabel(badge, length, digitBadge) {
    if (badge.relicWord) {
      const wordLength = badge.relicWord.length;
      if (length !== wordLength) return "—";
      return formatOneInChance(Math.pow(26, wordLength));
    }

    if (badge.fragment) {
      const fragmentLength = badge.fragment.length;
      if (length < fragmentLength) return "0%";
      return formatProbabilityLabel(getContainsAnyPatternChance([badge.fragment], length, LETTERS));
    }

    if (badge.pattern && digitBadge) {
      const patternLength = badge.pattern.length;
      if (badge.patternMode === "exact") {
        if (length !== patternLength) return "—";
        return formatOneInChance(Math.pow(10, patternLength));
      }
      if (length < patternLength) return "0%";
      return formatProbabilityLabel(getContainsAnyPatternChance([badge.pattern], length, NUMBERS));
    }

    if (badge.sigmaTarget) {
      return "Sigma";
    }

    return "";
  }

  function formatProbabilityLabel(chance) {
    if (!Number.isFinite(chance) || chance <= 0) return "0%";
    if (chance < 0.0001) return formatOneInChance(1 / chance);
    const percent = chance * 100;
    if (percent < 0.01) return formatPercent(percent, 5);
    if (percent < 1) return formatPercent(percent, 4);
    return formatPercent(percent, 3);
  }

  function formatPercent(percent, digits = 2) {
    return `${percent.toFixed(digits).replace(/\.?0+$/, "")}%`;
  }

  function formatOneInChance(denominator) {
    if (!Number.isFinite(denominator) || denominator <= 0) return "Ultra";
    return `1 / ${formatNumber(Math.max(1, Math.round(denominator)))}`;
  }

  function generateOddsSequence(alphabet, length, sample, salt) {
    let value = (sample + 1) * 2654435761 + salt * 1013904223;
    let sequence = "";
    for (let index = 0; index < length; index += 1) {
      value = (Math.imul(value ^ (index + 17), 1664525) + 1013904223) >>> 0;
      sequence += alphabet[value % alphabet.length];
    }
    return sequence;
  }

  function buildOddsContext(sequence, derived) {
    const chars = [...sequence];
    const letters = chars.filter(isLetter);
    const numbers = chars.filter((char) => /\d/.test(char));
    const digitValues = numbers.map((char) => Number(char));
    const counts = countCharacters(chars);
    const letterCounts = countCharacters(letters);
    const numberCounts = countCharacters(numbers);
    const values = Object.values(counts);
    const letterPositions = letters.map(getAlphabetPosition);
    const words = derived.rollMode === "numbers" ? [] : findWords(sequence);
    const longestWordLength = words.reduce((max, word) => Math.max(max, Number(word.length || word.word?.length || 0)), 0);

    return {
      sequence,
      rollMode: derived.rollMode,
      isLetterRoll: derived.rollMode === "letters",
      isNumberRoll: derived.rollMode === "numbers",
      chars,
      letters,
      numbers,
      digitValues,
      counts,
      letterCounts,
      numberCounts,
      maxCount: values.length ? Math.max(...values) : 0,
      uniqueCount: new Set(chars).size,
      pairCount: values.filter((count) => count >= 2).length,
      exactPairCount: values.filter((count) => count === 2).length,
      hasPair: values.some((count) => count === 2),
      hasTriple: values.some((count) => count === 3),
      alphaScore: letters.reduce((sum, char) => sum + getAlphabetPosition(char), 0),
      highCount: letters.filter((char) => getAlphabetPosition(char) >= 14).length,
      lowCount: letters.filter((char) => getAlphabetPosition(char) <= 13).length,
      letterCount: letters.length,
      numberCount: numbers.length,
      consonantCount: letters.filter((char) => !VOWELS.has(char)).length,
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
      glitchedBonus: false,
      luckSurge: false,
      mythicPulse: false,
      cosmicPulse: false,
      realityRift: false,
      abyssalJackpot: false,
      derived,
    };
  }

  function formatChance(chance, samples) {
    if (chance <= 0) return "0%";
    if (chance >= 0.995) return "100%";
    if (chance < 1 / samples) return `<${formatPercent(100 / samples, 2)}`;
    return formatProbabilityLabel(chance);
  }

  function renderCutsceneIndex() {
    if (!dom.cutsceneIndexGrid) return;
    cutsceneRenderToken += 1;

    const sceneBadges = BADGES
      .filter((badge) => (RARITIES[badge.rarity]?.rank || 0) >= RARITIES.epic.rank)
      .sort((a, b) => (RARITIES[b.rarity]?.rank || 0) - (RARITIES[a.rarity]?.rank || 0) || a.name.localeCompare(b.name));
    const unlockedCount = sceneBadges.filter((badge) => state.badges[badge.id]).length;
    const progress = sceneBadges.length ? unlockedCount / sceneBadges.length : 0;

    dom.cutsceneProgressText.textContent = `${unlockedCount} / ${sceneBadges.length}`;
    dom.cutscenePercent.textContent = `${Math.round(progress * 100)}%`;
    dom.cutsceneRing.style.setProperty("--progress", `${Math.round(progress * 360)}deg`);
    dom.cutsceneIndexGrid.innerHTML = "";

    renderCutsceneCardsBatched(sceneBadges, cutsceneRenderToken);
  }

  function renderCutsceneCardsBatched(sceneBadges, token) {
    const batchSize = LOW_POWER_MODE ? 10 : 20;
    let index = 0;
    const progressNode = document.createElement("div");
    progressNode.className = "grid-progress-note";

    const renderBatch = () => {
      if (token !== cutsceneRenderToken || activePage !== "cutscenes") return;

    const fragment = document.createDocumentFragment();
      const end = Math.min(index + batchSize, sceneBadges.length);
      for (; index < end; index += 1) {
        const badge = sceneBadges[index];
      const rarity = RARITIES[badge.rarity] || RARITIES.epic;
      const style = getCutsceneStyleForBadge(badge);
      const unlocked = Boolean(state.badges[badge.id]);
      const card = document.createElement("article");
      card.className = `cutscene-index-card ${unlocked ? "unlocked" : "locked"}`;
      card.style.setProperty("--scene-color", style.color);
      card.innerHTML = `
        <div class="scene-card-top">
          <span class="scene-card-icon">${escapeHtml(style.icon)}</span>
          <b class="scene-card-rarity">${escapeHtml(rarity.label)}</b>
        </div>
        <h3>${escapeHtml(badge.name)}</h3>
        <p>${escapeHtml(style.copy)}</p>
        <small>${unlocked ? "Discovered" : "Preview available · undiscovered in archive"}</small>
        <button type="button">Preview ${escapeHtml(style.name)}</button>
      `;
      card.querySelector("button").addEventListener("click", () => {
        showBadgeCutscene(createPreviewResultForBadge(badge), badge, true);
      });
      fragment.appendChild(card);
      }
      if (progressNode.isConnected) progressNode.remove();
    dom.cutsceneIndexGrid.appendChild(fragment);

      if (index < sceneBadges.length) {
        progressNode.textContent = `Loading cutscene archive ${index} / ${sceneBadges.length}...`;
        dom.cutsceneIndexGrid.appendChild(progressNode);
        scheduleBackgroundTask(renderBatch, 16);
      }
    };

    renderBatch();
  }

  function createPreviewResultForBadge(badge) {
    const digitBadge = isNumberBadge(badge);
    const result = {
      sequence: digitBadge ? "ALPHAX67" : "ALPHAR67",
      letterSequence: digitBadge ? "ALPHAX" : "ALPHAR",
      numberSequence: digitBadge ? "67" : "42",
      tier: badge.rarity || "epic",
      glyphsEarned: Math.max(1200, Number(badge.value || 0) + 777),
      alphabetBadgeGlyphs: Math.max(700, Number(badge.value || 0)),
      badgeGlyphsBoosted: Math.max(900, Number(badge.value || 0) * 1.5),
      numberMultiplier: digitBadge ? 1 + Number(badge.numberMultiplier || 0.5) : 1.25,
      words: /word|lexicon|gemini|said|cover/i.test(badge.id) ? [{ word: "ALPHA", start: 0, length: 5, source: "preview" }] : [],
      earnedBadges: [{ ...badge, isNew: true, value: digitBadge ? 0 : badge.value }],
    };
    return result;
  }

  function getCutsceneStyleForBadge(badge) {
    const id = badge?.id || "";
    if (badge?.rarity === "glitched" || /glitch|void|omega/.test(id)) return CUTSCENE_STYLES.find((style) => style.id === "glitch");
    if (badge?.rarity === "mythic" || /mythic|king|omega|hero|pulse/.test(id)) return CUTSCENE_STYLES.find((style) => style.id === "mythic");
    if (isNumberBadge(badge) || /digit|number|checksum|prime|zero|seven|binary|pi|fibonacci|square|hydrogen|liftoff|landing|six|surge/.test(id)) return CUTSCENE_STYLES.find((style) => style.id === "digit");
    if (/word|lexicon|gemini|said|cover|monarch|opening|ending/.test(id)) return CUTSCENE_STYLES.find((style) => style.id === "word");
    if (/mirror|palindrome|bookend|symmetry|gate/.test(id)) return CUTSCENE_STYLES.find((style) => style.id === "mirror");
    if (/royal|rare|q_|x_|zed|alpha_omega/.test(id)) return CUTSCENE_STYLES.find((style) => style.id === "royal");
    if (/pair|triple|quad|stack|house|snake|zigzag|switch|chaos|run/.test(id)) return CUTSCENE_STYLES.find((style) => style.id === "pattern");
    return CUTSCENE_STYLES.find((style) => style.id === "alphabet") || CUTSCENE_STYLES[0];
  }

  function renderUpgrades() {
    const ownedCount = UPGRADES.filter((upgrade) => state.upgrades[upgrade.id]).length;
    dom.forgeGlyphs.textContent = formatNumber(state.glyphs);
    dom.upgradeGrid.innerHTML = "";
    dom.upgradeGrid.className = "upgrade-sections";

    const sectionFragment = document.createDocumentFragment();
    UPGRADE_SECTIONS.forEach((section) => {
      const upgrades = UPGRADES.filter((upgrade) => getUpgradeSection(upgrade) === section.id);
      if (!upgrades.length) return;

      const ownedInSection = upgrades.filter((upgrade) => state.upgrades[upgrade.id]).length;
      const collapsed = collapsedUpgradeSections.has(section.id);
      const shell = document.createElement("article");
      shell.className = `upgrade-section${collapsed ? " collapsed" : ""}`;
      shell.innerHTML = `
        <button class="upgrade-section-toggle" type="button" aria-expanded="${String(!collapsed)}">
          <span>
            <strong>${escapeHtml(section.title)}</strong>
            <small>${escapeHtml(section.subtitle)}</small>
          </span>
          <b>${ownedInSection}/${upgrades.length}</b>
          <i>${collapsed ? "+" : "-"}</i>
        </button>
      `;

      shell.querySelector(".upgrade-section-toggle").addEventListener("click", () => {
        if (collapsedUpgradeSections.has(section.id)) {
          collapsedUpgradeSections.delete(section.id);
        } else {
          collapsedUpgradeSections.add(section.id);
        }
        renderUpgrades();
      });

      const grid = document.createElement("div");
      grid.className = "upgrade-grid";
      const maxRows = Math.max(...upgrades.map((upgrade) => upgrade.row || 1));
      const maxCols = Math.max(2, ...upgrades.map((upgrade) => upgrade.col || 1));
      grid.style.setProperty("--section-rows", String(maxRows));
      grid.style.setProperty("--section-cols", String(maxCols));
      grid.appendChild(createUpgradeLinks(upgrades, maxRows, maxCols));

      upgrades.forEach((upgrade) => {
        const status = getUpgradeStatus(upgrade);
        const node = document.createElement("button");
        node.className = `upgrade-node ${status}${upgrade.deps.length ? "" : " root"}${upgrade.prestige ? " prestige" : ""}`;
        node.type = "button";
        node.dataset.row = upgrade.row;
        node.dataset.col = upgrade.col;
        node.style.gridRow = String(upgrade.row);
        node.style.gridColumn = String(upgrade.col);
        node.disabled = status === "locked";
        node.title = getUpgradeTooltip(upgrade, status);
        node.innerHTML = `
          <span class="node-icon">${escapeHtml(upgrade.icon)}</span>
          <span class="node-copy">
            <strong>${escapeHtml(upgrade.name)}</strong>
            <p>${escapeHtml(upgrade.description)}</p>
            <span class="node-cost"><i>◆</i>${status === "owned" ? "Owned" : `${formatNumber(upgrade.cost)} · ${escapeHtml(upgrade.effect)}`}</span>
          </span>
        `;

        node.addEventListener("click", () => buyUpgrade(upgrade));
        grid.appendChild(node);
      });

      shell.appendChild(grid);
      sectionFragment.appendChild(shell);
    });
    dom.upgradeGrid.appendChild(sectionFragment);

    dom.upgradeCount.textContent = `${ownedCount} / ${UPGRADES.length}`;
    dom.upgradeProgress.style.width = `${Math.round((ownedCount / UPGRADES.length) * 100)}%`;
    dom.upgradeProgressHint.textContent =
      ownedCount === UPGRADES.length
        ? "Every dice upgrade is online."
        : `${UPGRADES.length - ownedCount} dice upgrade${UPGRADES.length - ownedCount === 1 ? "" : "s"} still offline.`;
  }

  function getUpgradeSection(upgrade) {
    if (upgrade.section) return upgrade.section;
    if (upgrade.id.includes("cooldown") || upgrade.id.includes("sequence")) return "temporal";
    if (upgrade.id.includes("mixed") || upgrade.id.includes("scanner") || upgrade.id.includes("claim")) return "scanner";
    if (upgrade.prestige) return "endgame";
    return "core";
  }

  function createUpgradeLinks(upgrades, maxRows, maxCols) {
    const upgradeById = new Map(upgrades.map((upgrade) => [upgrade.id, upgrade]));
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "upgrade-link-svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");

    upgrades.forEach((upgrade) => {
      upgrade.deps
        .map((id) => upgradeById.get(id))
        .filter(Boolean)
        .forEach((dependency) => {
          const from = getTreePoint(dependency, maxRows, maxCols);
          const to = getTreePoint(upgrade, maxRows, maxCols);
          const midY = (from.y + to.y) / 2;
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`);
          path.setAttribute("class", state.upgrades[dependency.id] ? "owned-link" : "locked-link");
          svg.appendChild(path);
        });
    });

    return svg;
  }

  function getTreePoint(upgrade, maxRows, maxCols) {
    return {
      x: ((Number(upgrade.col) || 1) - 0.5) * (100 / maxCols),
      y: ((Number(upgrade.row) || 1) - 0.5) * (100 / maxRows),
    };
  }

  function renderUpgradesLegacy() {
    const ownedCount = UPGRADES.filter((upgrade) => state.upgrades[upgrade.id]).length;
    dom.forgeGlyphs.textContent = formatNumber(state.glyphs);
    dom.upgradeGrid.innerHTML = "";

    UPGRADES.forEach((upgrade) => {
      const status = getUpgradeStatus(upgrade);
      const node = document.createElement("button");
      node.className = `upgrade-node ${status}${upgrade.deps.length ? "" : " root"}${upgrade.prestige ? " prestige" : ""}`;
      node.type = "button";
      node.dataset.row = upgrade.row;
      node.dataset.col = upgrade.col;
      node.style.gridRow = String(upgrade.row);
      node.style.gridColumn = String(upgrade.col);
      node.disabled = status === "locked";
      node.title = getUpgradeTooltip(upgrade, status);
      node.innerHTML = `
        <span class="node-icon">${escapeHtml(upgrade.icon)}</span>
        <span class="node-copy">
          <strong>${escapeHtml(upgrade.name)}</strong>
          <p>${escapeHtml(upgrade.description)}</p>
          <span class="node-cost"><i>◆</i>${status === "owned" ? "Owned" : `${formatNumber(upgrade.cost)} · ${escapeHtml(upgrade.effect)}`}</span>
        </span>
      `;

      node.addEventListener("click", () => buyUpgrade(upgrade));
      dom.upgradeGrid.appendChild(node);
    });

    dom.upgradeCount.textContent = `${ownedCount} / ${UPGRADES.length}`;
    dom.upgradeProgress.style.width = `${Math.round((ownedCount / UPGRADES.length) * 100)}%`;
    dom.upgradeProgressHint.textContent =
      ownedCount === UPGRADES.length
        ? "Every dice upgrade is online."
        : `${UPGRADES.length - ownedCount} dice upgrade${UPGRADES.length - ownedCount === 1 ? "" : "s"} still offline.`;
  }

  function buyUpgrade(upgrade) {
    if (!ACTIVE_UPGRADE_IDS.has(upgrade.id)) {
      playTone("error");
      showToast("That old upgrade has been retired. Only dice upgrades remain.", "error");
      return;
    }

    const status = getUpgradeStatus(upgrade);

    if (status === "owned") {
      showToast(`${upgrade.name} is already active.`);
      return;
    }

    if (status === "locked") {
      playTone("error");
      showToast(getUpgradeTooltip(upgrade, status), "error");
      return;
    }

    if (state.glyphs < upgrade.cost) {
      playTone("error");
      showToast(`Need ${formatNumber(upgrade.cost - state.glyphs)} more Glyphs for ${upgrade.name}.`, "error");
      return;
    }

    state.glyphs -= upgrade.cost;
    state.upgrades[upgrade.id] = true;
    saveState();
    playTone("upgrade");
    showToast(`${upgrade.name} activated.`);
    renderAll();
  }

  function getUpgradeStatus(upgrade) {
    if (state.upgrades[upgrade.id]) return "owned";
    const depsOwned = upgrade.deps.every((id) => state.upgrades[id]);
    if (!depsOwned) return "locked";
    if (upgrade.lifetimeRequired && state.totalGlyphs < upgrade.lifetimeRequired) return "locked";
    if (state.glyphs < upgrade.cost) return "poor";
    return "available";
  }

  function getUpgradeTooltip(upgrade, status) {
    if (status === "owned") return `${upgrade.name} is owned.`;
    const missingDeps = upgrade.deps.filter((id) => !state.upgrades[id]).map(getUpgradeName);
    if (missingDeps.length) return `Requires ${missingDeps.join(", ")}.`;
    if (upgrade.lifetimeRequired && state.totalGlyphs < upgrade.lifetimeRequired) {
      return `Requires ${formatNumber(upgrade.lifetimeRequired)} lifetime Glyphs.`;
    }
    if (state.glyphs < upgrade.cost) return `Need ${formatNumber(upgrade.cost - state.glyphs)} more Glyphs.`;
    return `Activate ${upgrade.name} for ${formatNumber(upgrade.cost)} Glyphs.`;
  }

  function renderStats() {
    const derived = getDerivedStats();
    const discovered = getDiscoveredBadges();
    const progress = BADGES.length ? discovered.length / BADGES.length : 0;

    dom.statRolls.textContent = formatNumber(state.totalRolls);
    dom.statGlyphs.textContent = formatNumber(state.totalGlyphs);
    dom.statLuck.textContent = formatLuck(derived.luck);
    dom.statBadges.textContent = `${discovered.length} / ${BADGES.length}`;
    dom.statBadgePercent.textContent = `${Math.round(progress * 100)}% of the archive`;

    if (state.bestRoll) {
      dom.bestTier.textContent = TIER_LABELS[state.bestRoll.tier].toUpperCase();
      dom.bestTier.dataset.tier = state.bestRoll.tier;
      dom.bestSequence.textContent = formatRollSequence(state.bestRoll);
      dom.bestValue.textContent = `${formatNumber(state.bestRoll.glyphsEarned)} Glyphs`;
      dom.bestBadges.textContent = `${formatNumber(state.bestRoll.badgeCount || 0)} earned`;
    } else {
      dom.bestTier.textContent = "—";
      delete dom.bestTier.dataset.tier;
      dom.bestSequence.textContent = "— — — — — —";
      dom.bestValue.textContent = "0 Glyphs";
      dom.bestBadges.textContent = "0 earned";
    }

    renderRarestDiscovery();
    renderNextRollStat();
  }

  function renderRarestDiscovery() {
    const badge = BADGES.find((item) => item.id === state.rarestBadgeId);

    if (!badge) {
      dom.rarestDisplay.innerHTML = `
        <div class="rarity-orb">?</div>
        <div><strong>Nothing yet</strong><p>Roll to discover your first badge.</p></div>
      `;
      return;
    }

    const rarity = RARITIES[badge.rarity];
    const info = state.badges[badge.id];
    dom.rarestDisplay.innerHTML = `
      <div class="rarity-orb" style="color:${rarity.color}; background:${rarity.soft};">${escapeHtml(badge.icon)}</div>
      <div>
        <strong>${escapeHtml(badge.name)}</strong>
        <p>${rarity.label} · earned ${formatNumber(info.count)} time${info.count === 1 ? "" : "s"}. Best signal: ${escapeHtml(info.bestRoll?.sequence || "—")}.</p>
      </div>
    `;
  }

  function renderNextRollStat() {
    const remaining = getRemainingMs();
    if (hasAdminPowers()) {
      dom.statNextRoll.textContent = "ADMIN READY";
      dom.statNextHint.textContent = "Admin powers are active: no roll cooldown.";
      return;
    }

    if (remaining <= 0) {
      dom.statNextRoll.textContent = "READY NOW";
      dom.statNextHint.textContent = "The sequence chamber is fully charged.";
      return;
    }

    dom.statNextRoll.textContent = formatDuration(remaining);
    dom.statNextHint.textContent = `Available at ${new Date(state.nextRollAt).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })}.`;
  }

  function renderLeaderboard() {
    const apiBase = getBackendUrl();
    const activeBoard = getActiveLeaderboardBoard();
    const rows = getLeaderboardRows();
    const boardMeta = getLeaderboardBoardMeta(activeBoard);

    dom.leaderboardMode.textContent = apiBase ? "GLOBAL READY" : "LOCAL DEMO";
    dom.leaderboardStatus.textContent = state.leaderboard.lastSyncStatus || (apiBase ? "Backend configured" : "Backend not connected");
    if (dom.leaderboardMetricHead) dom.leaderboardMetricHead.textContent = boardMeta.metricHead;
    dom.leaderboardTabs.forEach((button) => {
      button.classList.toggle("active", button.dataset.leaderboardBoard === activeBoard);
    });
    dom.leaderboardRows.innerHTML = "";

    if (!rows.length) {
      dom.leaderboardRows.innerHTML = `<div class="leaderboard-empty">No ${escapeHtml(boardMeta.emptyLabel)} yet. Roll while signed in to claim the board.</div>`;
      return;
    }

    rows.forEach((row, index) => {
      const item = document.createElement("div");
      item.className = `leaderboard-row${index < 3 ? " top-rank" : ""}`;
      const metric = getLeaderboardMetricText(row, activeBoard);
      item.innerHTML = `
        <span class="leader-rank">#${index + 1}</span>
        <span class="leader-player">
          <strong>${escapeHtml(row.player)}</strong>
          <small>${escapeHtml(getLeaderboardSubtext(row, activeBoard))}</small>
        </span>
        <span class="leader-sequence">${escapeHtml(formatLeaderboardSequence(row))}</span>
        <span class="leader-row-tier"><span class="tier-pill" data-tier="${escapeHtml(row.tier)}">${escapeHtml(TIER_LABELS[row.tier] || row.tier).toUpperCase()}</span></span>
        <span class="leader-glyphs">${escapeHtml(metric)}</span>
      `;
      dom.leaderboardRows.appendChild(item);
    });
  }

  function getActiveLeaderboardBoard() {
    const board = state.leaderboard.activeBoard || "daily";
    return ["daily", "weekly", "allTime", "topGlyphs", "topRolls"].includes(board) ? board : "daily";
  }

  function getLeaderboardBoardMeta(board) {
    const meta = {
      daily: { metricHead: "Glyphs", emptyLabel: "daily rolls" },
      weekly: { metricHead: "Glyphs", emptyLabel: "weekly rolls" },
      allTime: { metricHead: "Glyphs", emptyLabel: "all-time rolls" },
      topGlyphs: { metricHead: "Total Glyphs", emptyLabel: "Glyph totals" },
      topRolls: { metricHead: "Total rolls", emptyLabel: "roll totals" },
    };
    return meta[board] || meta.daily;
  }

  function getLeaderboardMetricText(row, board) {
    if (board === "topRolls") return `🎲 ${formatNumber(row.totalRolls || 0)}`;
    if (board === "topGlyphs") return `◆ ${formatNumber(row.totalGlyphs || row.glyphs || 0)}`;
    return `◆ ${formatNumber(row.glyphs || 0)}`;
  }

  function getLeaderboardSubtext(row, board) {
    if (board === "topRolls") return `${formatNumber(row.totalGlyphs || 0)} total Glyphs`;
    if (board === "topGlyphs") return `${formatNumber(row.totalRolls || 0)} total rolls`;
    return row.at
      ? new Date(row.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "global account";
  }

  function formatLeaderboardSequence(row) {
    if (row.letterSequence || row.numberSequence) {
      return `${row.letterSequence || ""}${row.letterSequence && row.numberSequence ? " × " : ""}${row.numberSequence || ""}` || "—";
    }
    const sequence = String(row.sequence || "—");
    return sequence === "—" ? sequence : [...sequence].join(" ");
  }

  function renderAccount() {
    const apiBase = getBackendUrl();
    const configuredApiBase = getConfiguredBackendCandidate();
    const signedIn = state.account.signedIn;
    const mode = apiBase ? "Live backend" : configuredApiBase ? "Backend offline" : "Local demo";

    dom.accountState.innerHTML = `
      <span>STATUS</span>
      <strong>${escapeHtml(signedIn ? getPlayerName() : "Guest mode")}</strong>
      <small>${escapeHtml(hasAdminPowers() ? "Admin powers active · no cooldown" : signedIn ? "Magic-link session active" : mode)}</small>
    `;

    if (document.activeElement !== dom.displayNameInput) dom.displayNameInput.value = signedIn ? state.account.displayName : dom.displayNameInput.value;
    if (document.activeElement !== dom.emailInput) dom.emailInput.value = signedIn ? state.account.email : dom.emailInput.value;
    if (document.activeElement !== dom.apiBaseInput) dom.apiBaseInput.value = configuredApiBase;

    dom.authModeText.textContent = apiBase
      ? backendHealth?.emailConfigured
        ? "Magic-link mode is live. The server will email a private sign-in link, then save progress and leaderboard identity globally."
        : "Magic-link mode is running, but email delivery is not configured yet. Add SMTP or Resend settings to .env."
      : "Magic-link login requires the AlphaRNG server. Open the game through localhost or your deployed multiplayer URL.";

    dom.authPasswordHelp.textContent = apiBase
      ? "No password is stored. Click the emailed link to create a secure HttpOnly session."
      : "Static file mode cannot send email links or save global accounts.";

    dom.twoStepHint.textContent = pendingTwoStepCode
      ? "Dev magic link generated. Open it to finish sign-in."
      : apiBase
        ? backendHealth?.emailConfigured ? "Send a magic link, then check any inbox you entered." : "Email delivery is offline. Configure SMTP_USER and SMTP_PASS in .env."
        : "Start the AlphaRNG server to send magic links.";

    dom.signInButton.textContent = signedIn ? "Send another magic link" : "Send magic link";
    dom.signOutButton.disabled = !signedIn;
    dom.integrationStatus.textContent = apiBase ? backendHealth?.emailConfigured ? "Magic links live" : "Email setup needed" : configuredApiBase ? "Configured, offline" : "Server required";
    dom.leaderboardIntegrationStatus.textContent = apiBase ? "Live backend" : configuredApiBase ? "Configured, offline" : "Local demo";
    dom.geminiStatus.textContent = apiBase
      ? backendHealth?.geminiConfigured ? "Gemini active on server" : "Server fallback until GEMINI_API_KEY"
      : "Local lexicon fallback";
  }

  function getLeaderboardRows() {
    const board = getActiveLeaderboardBoard();
    const boards = state.leaderboard.boards || {};
    if (Array.isArray(boards[board])) return boards[board].slice(0, 50);

    const localRows = Array.isArray(state.leaderboard.localRows) ? state.leaderboard.localRows : [];
    const currentBest = state.bestRoll
      ? [{
          player: getPlayerName(),
          email: state.account.email || "local@alpharng",
          sequence: state.bestRoll.sequence,
          letterSequence: state.bestRoll.letterSequence || "",
          numberSequence: state.bestRoll.numberSequence || "",
          tier: state.bestRoll.tier,
          glyphs: state.bestRoll.glyphsEarned,
          totalGlyphs: state.totalGlyphs,
          totalRolls: state.totalRolls,
          badges: state.bestRoll.badgeCount || 0,
          at: state.bestRoll.at || Date.now(),
        }]
      : [];

    const rows = [...currentBest, ...localRows, ...DEMO_LEADERBOARD]
      .filter((row) => row.sequence && Number.isFinite(Number(row.glyphs)))
      .filter((row) => {
        const at = Number(row.at) || 0;
        if (board === "daily") return at >= Date.now() - 24 * 60 * 60 * 1000;
        if (board === "weekly") return at >= Date.now() - 7 * 24 * 60 * 60 * 1000;
        return true;
      });

    if (board === "topGlyphs") {
      return rows.sort((a, b) => Number(b.totalGlyphs || b.glyphs || 0) - Number(a.totalGlyphs || a.glyphs || 0)).slice(0, 12);
    }
    if (board === "topRolls") {
      return rows.sort((a, b) => Number(b.totalRolls || 0) - Number(a.totalRolls || 0)).slice(0, 12);
    }
    return rows.sort((a, b) => Number(b.glyphs) - Number(a.glyphs)).slice(0, 12);
  }

  async function syncLeaderboard(manual = false, rollResult = null) {
    const sourceRoll = rollResult || state.bestRoll;
    if (!sourceRoll) {
      if (manual) showToast("Roll once before syncing a leaderboard score.", "error");
      return;
    }

    const rollAt = Number(sourceRoll.at) || Date.now();
    const row = {
      rollId: `${state.account.email || "local"}:${rollAt}:${sourceRoll.sequence}:${sourceRoll.glyphsEarned}`,
      player: getPlayerName(),
      email: state.account.email || "local@alpharng",
      sequence: sourceRoll.sequence,
      letterSequence: sourceRoll.letterSequence || "",
      numberSequence: sourceRoll.numberSequence || "",
      tier: sourceRoll.tier,
      glyphs: sourceRoll.glyphsEarned,
      totalGlyphs: state.totalGlyphs,
      totalRolls: state.totalRolls,
      badges: sourceRoll.badgeCount || sourceRoll.earnedBadges?.length || 0,
      at: rollAt,
    };

    const apiBase = getBackendUrl();
    if (!apiBase) {
      upsertLocalLeaderboard(row);
      state.leaderboard.lastSyncStatus = "Saved to local demo board";
      state.leaderboard.lastSyncAt = Date.now();
      saveState();
      if (activePage === "leaderboard") renderLeaderboard();
      if (manual) showToast("Best roll saved to the local demo leaderboard.");
      return;
    }

    try {
      const response = await safeFetch(buildApiUrl(apiBase, "/leaderboard/scores"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        timeoutMs: 5000,
        body: JSON.stringify(row),
      });

      if (!response.ok) throw new Error(`Leaderboard sync returned ${response.status}`);
      const payload = await response.json();
      state.leaderboard.localRows = Array.isArray(payload.rows) ? payload.rows : state.leaderboard.localRows;
      if (payload.boards && typeof payload.boards === "object") state.leaderboard.boards = payload.boards;
      state.leaderboard.lastSyncStatus = "Synced globally";
      state.leaderboard.lastSyncAt = Date.now();
      saveState();
      if (activePage === "leaderboard") renderLeaderboard();
      if (manual) showToast("Best roll synced to backend leaderboard.");
    } catch (error) {
      console.warn("Leaderboard backend unavailable; saving locally.", error);
      upsertLocalLeaderboard(row);
      state.leaderboard.lastSyncStatus = "Backend unavailable; local fallback";
      saveState();
      if (activePage === "leaderboard") renderLeaderboard();
      if (manual) showToast("Backend unavailable, saved locally instead.", "error");
    }
  }

  function upsertLocalLeaderboard(row) {
    const rows = Array.isArray(state.leaderboard.localRows) ? [...state.leaderboard.localRows] : [];
    const key = row.rollId || `${row.email || row.player}:${row.at}:${row.sequence}`;
    const existingIndex = rows.findIndex((item) => (
      item.rollId || `${item.email || item.player}:${item.at}:${item.sequence}`
    ) === key);

    if (existingIndex >= 0) {
      if (Number(row.glyphs) > Number(rows[existingIndex].glyphs || 0)) rows[existingIndex] = row;
    } else {
      rows.push(row);
    }

    state.leaderboard.localRows = rows.sort((a, b) => Number(b.at || 0) - Number(a.at || 0)).slice(0, 200);
    state.leaderboard.boards = {};
  }

  async function sendTwoStepCode() {
    const displayName = dom.displayNameInput.value.trim() || "Alpha Roller";
    const email = dom.emailInput.value.trim();
    if (!email) {
      showToast("Enter an email first.", "error");
      dom.emailInput.focus();
      return;
    }
    if (!isValidEmailAddress(email)) {
      showToast("Enter a valid email address.", "error");
      dom.emailInput.focus();
      return;
    }

    const apiBase = getBackendUrl();
    if (apiBase) {
      try {
        const response = await safeFetch(buildApiUrl(apiBase, "/auth/magic/start"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          timeoutMs: 8000,
          body: JSON.stringify({ displayName, email }),
        });
        if (!response.ok) throw new Error(`Magic-link start returned ${response.status}`);
        const payload = await response.json();
        pendingTwoStepCode = payload.devLink || "";
        if (payload.devLink) {
          dom.twoStepHint.innerHTML = `Dev magic link: <a href="${escapeHtml(payload.devLink)}">open sign-in link</a>`;
        } else {
          dom.twoStepHint.textContent = "Magic link sent. Check your email, then click the link to sign in.";
        }
        showToast(payload.emailSent ? "Magic link sent by email." : "Dev magic link generated.");
        return;
      } catch (error) {
        console.warn("Magic-link backend unavailable.", error);
        showToast("Magic links require the live server. Start or deploy the backend first.", "error");
        dom.twoStepHint.textContent = "Magic-link login needs the AlphaRNG server.";
        return;
      }
    }

    showToast("Open AlphaRNG through the server to use multiplayer login.", "error");
    dom.twoStepHint.textContent = "Magic-link login only works through the AlphaRNG server.";
  }

  async function signInPlayer(event) {
    event.preventDefault();
    await sendTwoStepCode();
  }

  async function signOutPlayer() {
    const apiBase = getBackendUrl();
    if (apiBase) {
      try {
        await safeFetch(buildApiUrl(apiBase, "/auth/logout"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: "{}",
        });
      } catch (error) {
        console.warn("Backend sign-out failed; clearing local account state.", error);
      }
    }
    state.account = cloneDefaultState().account;
    pendingTwoStepCode = "";
    saveState();
    renderAll();
    showToast("Signed out on this device.");
  }

  async function saveBackendUrl() {
    const cleanUrl = normalizeBackendUrl(dom.apiBaseInput.value);
    state.settings.apiBase = cleanUrl;
    if (cleanUrl) {
      localStorage.setItem(BACKEND_CONFIG_KEY, cleanUrl);
      state.leaderboard.lastSyncStatus = "Backend configured";
      showToast("Backend URL saved.");
    } else {
      localStorage.removeItem(BACKEND_CONFIG_KEY);
      state.leaderboard.lastSyncStatus = "Local demo mode";
      showToast("Backend URL cleared. Local demo mode active.");
    }
    await refreshBackendStatus();
    saveState();
    renderAll();
  }

  function renderLastResult(result) {
    dom.emptyResult.classList.add("hidden");
    dom.resultContent.classList.remove("hidden");
    dom.resultTier.textContent = TIER_LABELS[result.tier].toUpperCase();
    dom.resultTier.dataset.tier = result.tier;
    dom.resultTime.textContent = getRelativeTime(result.at);
    if (dom.resultRollDisplay) dom.resultRollDisplay.textContent = formatRollSequence(result);
    if (dom.resultAlphaGlyphs) dom.resultAlphaGlyphs.textContent = formatNumber(result.alphabetBadgeGlyphs || result.badgeGlyphs || 0);
    if (dom.resultDigitMultiplier) dom.resultDigitMultiplier.textContent = (Number(result.numberMultiplier) || 1).toFixed(2);
    if (dom.resultFinalGlyphs) dom.resultFinalGlyphs.textContent = formatNumber(result.glyphsEarned);
    if (dom.resultFormula) {
      const alphaGlyphs = formatNumber(result.alphabetBadgeGlyphs || result.badgeGlyphs || 0);
      const boostedGlyphs = formatNumber(result.badgeGlyphsBoosted || 0);
      dom.resultFormula.textContent = `${alphaGlyphs} alphabet Glyphs × ${(Number(result.numberMultiplier) || 1).toFixed(2)} digit boost = ${boostedGlyphs}, then base + Luck.`;
    }
    dom.earnedCount.textContent = result.earnedBadges.length;
    dom.earnedList.innerHTML = "";

    if (result.words.length) {
      dom.wordFind.classList.remove("hidden");
      dom.wordChips.innerHTML = "";
      const wordFragment = document.createDocumentFragment();
      result.words.slice(0, 8).forEach(({ word }) => {
        const chip = document.createElement("span");
        chip.className = "word-chip";
        chip.textContent = word;
        wordFragment.appendChild(chip);
      });
      dom.wordChips.appendChild(wordFragment);
    } else {
      dom.wordFind.classList.add("hidden");
      dom.wordChips.innerHTML = "";
    }

    if (!result.earnedBadges.length) {
      const empty = document.createElement("div");
      empty.className = "no-badges-roll";
      empty.textContent = "No badge this time — the base Glyphs are still yours.";
      dom.earnedList.appendChild(empty);
      return;
    }

    const badgeFragment = document.createDocumentFragment();
    result.earnedBadges.forEach((earned) => {
      const badge = BADGES.find((item) => item.id === earned.id) || earned;
      const rarity = RARITIES[earned.rarity];
      const valueText = earned.numberMultiplier
        ? `+${Number(earned.numberMultiplier).toFixed(2)}x digit boost`
        : `+${formatNumber(earned.value)}`;
      const alphaBoostText = earned.numberMultiplier
        ? ` +${Number(earned.numberMultiplier).toFixed(2)}x Alpha`
        : "";
      const boostText = earned.numberMultiplier
        ? ` ×${(1 + Number(earned.numberMultiplier)).toFixed(2)}`
        : "";
      const row = document.createElement("div");
      row.className = "earned-badge breakdown-badge";
      row.innerHTML = `
        <span class="earned-badge-icon" style="color:${rarity.color}; background:${rarity.soft};">${escapeHtml(earned.icon)}</span>
        <div>
          <strong>${escapeHtml(earned.name)}${earned.isNew ? " · NEW" : ""}</strong>
          <span>${escapeHtml(rarity.label)} · ${escapeHtml(badge.description || earned.description)}</span>
        </div>
        <b>${escapeHtml(valueText)}</b>
      `;
      row.querySelector("div")?.insertAdjacentHTML("beforeend", renderBadgeTileStrip(result, earned));
      badgeFragment.appendChild(row);
    });
    dom.earnedList.appendChild(badgeFragment);
  }

  function renderBadgeTileStrip(result, badge) {
    const parts = getRollParts(result);
    const digitBadge = isNumberBadge(badge);
    const source = digitBadge ? parts.numberSequence : parts.letterSequence;
    if (!source) return "";

    const highlight = getBadgeHighlightMatcher(badge, source, digitBadge);
    const tiles = [...source].map((char, index) => {
      const active = highlight(char, index);
      return `<span class="${active ? "active" : ""}">${escapeHtml(char)}</span>`;
    }).join("");

    return `<div class="badge-tile-strip ${digitBadge ? "digit-strip" : "letter-strip"}">${tiles}</div>`;
  }

  function getBadgeHighlightMatcher(badge, source, digitBadge) {
    const id = badge?.id || "";
    if (digitBadge) {
      if (id === "sixty_seven_surge") {
        const start = source.indexOf("67");
        return (_, index) => start >= 0 && index >= start && index < start + 2;
      }
      if (id === "reverse_67") {
        const start = source.indexOf("76");
        return (_, index) => start >= 0 && index >= start && index < start + 2;
      }
      if (id === "hydrogen") return (char) => char === "1";
      if (/zero/.test(id)) return (char) => char === "0";
      if (/seven/.test(id)) return (char) => char === "7";
      if (/even/.test(id)) return (char) => Number(char) % 2 === 0;
      if (/odd|prime/.test(id)) return (char) => Number(char) % 2 === 1 || [2, 3, 5, 7].includes(Number(char));
      if (/checksum|sum|liftoff|landing|six/.test(id)) return () => true;
      return () => true;
    }

    if (/vowel/.test(id)) return (char) => VOWELS.has(char);
    if (/no_vowels|consonant/.test(id)) return (char) => !VOWELS.has(char);
    if (/rare|q_|x_|zed|edge|royal/.test(id)) return (char) => "QXZJAZK".includes(char);
    if (/quad_up|quad_down/.test(id)) {
      const direction = /down/.test(id) ? -1 : 1;
      for (let start = 0; start <= source.length - 4; start += 1) {
        const piece = source.slice(start, start + 4);
        if (hasAlphabetRun(piece, 4, direction)) {
          return (_, index) => index >= start && index < start + 4;
        }
      }
    }
    if (/abc|ladder|run/.test(id)) {
      const runs = ["ABC", "BCD", "CDE", "XYZ", "ZYX", "CBA"];
      const found = runs.map((run) => source.indexOf(run)).find((index) => index >= 0);
      return (_, index) => Number.isFinite(found) && index >= found && index < found + 3;
    }
    if (/word|lexicon|gemini|monarch|opening|ending/.test(id)) return () => true;
    if (/low|high|spectrum|sum|balance/.test(id)) return () => true;
    if (/double|pair|triple|quad|king|stack|tap|house/.test(id)) {
      const counts = countCharacters([...source]);
      return (char) => counts[char] >= 2;
    }
    return () => true;
  }

  function celebrateBadges(result) {
    if (!result.earnedBadges.length) return;

    const sceneBadges = getCutsceneBadgeCandidates(result);
    showBadgeBurstQueue(result);

    sceneBadges.slice(0, 1).forEach((badge, index) => {
      setTimeout(() => showBadgeCutscene(result, badge), 900 + result.earnedBadges.length * 260 + index * 900);
    });
  }

  function getCutsceneBadgeCandidates(result) {
    return [...(result.earnedBadges || [])]
      .filter((badge) => (RARITIES[badge.rarity]?.rank || 0) >= RARITIES.epic.rank)
      .sort((a, b) => {
        const newDiff = Number(b.isNew) - Number(a.isNew);
        if (newDiff) return newDiff;
        return (RARITIES[b.rarity]?.rank || 0) - (RARITIES[a.rarity]?.rank || 0);
      });
  }

  function getFeaturedBadges(result, limit = 5) {
    return [...(result.earnedBadges || [])]
      .sort((a, b) => {
        const newDiff = Number(b.isNew) - Number(a.isNew);
        if (newDiff) return newDiff;
        const rarityDiff = (RARITIES[b.rarity]?.rank || 0) - (RARITIES[a.rarity]?.rank || 0);
        if (rarityDiff) return rarityDiff;
        return (b.value || 0) - (a.value || 0);
      })
      .slice(0, limit);
  }

  function shouldShowCoreCutscene(result, badge, preview = false) {
    if (preview) return true;

    const badgeRank = RARITIES[badge?.rarity]?.rank || 0;
    const tierRank = getTierRank(result.tier);

    if (tierRank >= getTierRank("legendary") || badgeRank >= RARITIES.legendary.rank) return true;

    return false;
  }

  function getCutsceneEscalationProfile(badge, result = {}) {
    const rank = Math.max(RARITIES[badge?.rarity]?.rank || 0, getTierRank(result.tier || badge?.rarity || "epic"));

    if (rank >= RARITIES.glitched.rank) {
      return {
        id: "glitched",
        title: "GLITCHED RIFT",
        core: true,
        nodeCount: 6,
        shardCount: 5,
        holdDuration: 2100,
        tileDelay: 245,
        featuredBadges: 7,
        closeLabel: "Seal the rift",
        actionLabel: "Stabilize the impossible signal",
      };
    }

    if (rank >= RARITIES.mythic.rank) {
      return {
        id: "mythic",
        title: "MYTHIC CORE",
        core: true,
        nodeCount: 6,
        shardCount: 4,
        holdDuration: 1750,
        tileDelay: 220,
        featuredBadges: 6,
        closeLabel: "Claim mythic signal",
        actionLabel: "Focus the mythic aura",
      };
    }

    if (rank >= RARITIES.legendary.rank) {
      return {
        id: "legendary",
        title: "LEGENDARY GATE",
        core: true,
        nodeCount: 4,
        shardCount: 3,
        holdDuration: 1380,
        tileDelay: 175,
        featuredBadges: 5,
        closeLabel: "Claim legendary signal",
        actionLabel: "Charge the legendary gate",
      };
    }

    return {
      id: "epic",
      title: "EPIC BADGE",
      core: false,
      nodeCount: 0,
      shardCount: 3,
      holdDuration: 0,
      tileDelay: 90,
      featuredBadges: 3,
      closeLabel: "Claim badge",
      actionLabel: "Tap the shards to reveal",
    };
  }

  function getCutsceneVariant(result, badge, derived) {
    const tier = result.tier || badge?.rarity || "rare";
    const sequence = String(result.sequence || "");
    const isNumberSequence = /^[0-9]+$/.test(sequence) || badge?.rollMode === "numbers" || badge?.requiresMixed;
    const isWordSequence = Array.isArray(result.words) && result.words.length > 0;

    if (tier === "glitched" || badge?.rarity === "glitched") {
      return {
        id: "glitch",
        openingTitle: "Reality is tearing...",
        openingCopy: "The archive cannot stabilize this signal normally.",
        sequenceKicker: "GLITCH LOCK",
        sequenceTitle: "Fragments are snapping into place",
        sequenceCopy: "Every tile is being reconstructed through static.",
        stabilizeKicker: "ERROR CORE",
        stabilizeTitle: "Tap nodes, then hold",
        stabilizeCopy: "Stabilize the corrupted rift before opening the final signal.",
        syncedKicker: "GLITCH SYNCED",
        syncedTitle: "Corruption contained",
        syncedCopy: "Hold the gate open and claim the impossible pattern.",
      };
    }

    if (isNumberSequence) {
      return {
        id: derived.digit_cutscene_core ? "digit-core" : "digits",
        openingTitle: "Digit reactor online...",
        openingCopy: "The digit lane is compressing math patterns into Glyph pressure.",
        sequenceKicker: "DIGIT LOCK",
        sequenceTitle: "Numbers are aligning",
        sequenceCopy: "Each digit locks into the multiplier circuit.",
        stabilizeKicker: "BALANCE THE REACTOR",
        stabilizeTitle: "Tap nodes, then hold",
        stabilizeCopy: "Charge the circuit nodes for a faster number reveal.",
        syncedKicker: "REACTOR SYNCED",
        syncedTitle: "Multiplier stable",
        syncedCopy: "Hold the gate open and release the digit badge multiplier.",
      };
    }

    if (isWordSequence) {
      return {
        id: "lexicon",
        openingTitle: "Lexicon gate opening...",
        openingCopy: "Gemini and the archive found meaning inside the roll.",
        sequenceKicker: "WORD LOCK",
        sequenceTitle: "Letters are spelling themselves",
        sequenceCopy: "Watch the word signal line up before the reveal.",
        stabilizeKicker: "FOCUS THE LEXICON",
        stabilizeTitle: "Tap nodes, then hold",
        stabilizeCopy: "Charge the word gate to open the badge reveal.",
        syncedKicker: "LEXICON SYNCED",
        syncedTitle: "Meaning stabilized",
        syncedCopy: "Hold the gate open and archive the word signal.",
      };
    }

    if (tier === "mythic" || badge?.rarity === "mythic") {
      return {
        id: "mythic",
        openingTitle: "Mythic aura rising...",
        openingCopy: "A high-rarity letter signal is bending the chamber.",
        sequenceKicker: "MYTHIC LOCK",
        sequenceTitle: "Letters are orbiting the core",
        sequenceCopy: "Each tile is being pulled into mythic alignment.",
        stabilizeKicker: "FOCUS THE AURA",
        stabilizeTitle: "Tap nodes, then hold",
        stabilizeCopy: "Charge the aura nodes and force the reveal open.",
        syncedKicker: "AURA SYNCED",
        syncedTitle: "Mythic field stable",
        syncedCopy: "Hold the gate open and claim the mythic pulse.",
      };
    }

    return {
      id: derived.variant_director ? "arcade" : "letters",
      openingTitle: "Rift forming...",
      openingCopy: "The archive is locking onto a high-rarity sequence.",
      sequenceKicker: "SEQUENCE LOCK",
      sequenceTitle: "Letters are aligning",
      sequenceCopy: "Watch each tile lock into the rift before you stabilize it.",
      stabilizeKicker: "STABILIZE THE CORE",
      stabilizeTitle: "Tap nodes, then hold",
      stabilizeCopy: "Charge the focus nodes for a faster reveal, then hold the gate open.",
      syncedKicker: "SIGNAL SYNCED",
      syncedTitle: "Core stabilized",
      syncedCopy: "Hold the gate to tear open the final reveal.",
    };
  }

  function showCoreCutscene(result, badge, preview = false) {
    badge ||= {
      name: "Unknown Signal",
      description: "A high-rarity roll is pushing through the archive.",
      rarity: result.tier || "rare",
      value: result.glyphsEarned || 0,
      icon: "◆",
      isNew: false,
    };

    const tier = result.tier || badge.rarity || "rare";
    const derived = getDerivedStats();
    const variant = getCutsceneVariant(result, badge, derived);
    const profile = getCutsceneEscalationProfile(badge, result);
    const rarity = RARITIES[badge.rarity] || RARITIES[tier] || RARITIES.rare;
    const tierRank = getTierRank(tier);
    const badgeRank = RARITIES[badge.rarity]?.rank || 0;
    const isExtreme = tierRank >= getTierRank("mythic") || badgeRank >= RARITIES.mythic.rank;
    const sequence = String(result.sequence || "");
    const sequenceChars = [...sequence];
    const holdDuration = profile.holdDuration;
    const nodeLabels = ["I", "II", "III", "IV", "V", "VI"];
    const coreNodeCount = Math.max(4, profile.nodeCount || 4);
    const leftNodeCount = Math.ceil(coreNodeCount / 2);
    const rightNodeCount = coreNodeCount - leftNodeCount;
    const leftNodes = nodeLabels
      .slice(0, leftNodeCount)
      .map((label, index) => `<button class="cutscene-focus-node" type="button" aria-label="Charge focus node ${index + 1}">${label}</button>`)
      .join("");
    const rightNodes = nodeLabels
      .slice(leftNodeCount, leftNodeCount + rightNodeCount)
      .map((label, index) => `<button class="cutscene-focus-node" type="button" aria-label="Charge focus node ${leftNodeCount + index + 1}">${label}</button>`)
      .join("");
    const featuredBadges = getFeaturedBadges(result, preview ? Math.max(6, profile.featuredBadges) : profile.featuredBadges);
    const sequenceTiles = sequenceChars
      .map((char, index) => `<span style="--tile-delay:${index * 90}ms"><b>${escapeHtml(char)}</b></span>`)
      .join("");
    const badgeCards = featuredBadges
      .map((earned, index) => {
        const earnedRarity = RARITIES[earned.rarity] || RARITIES.common;
        return `
          <article class="cutscene-badge-card" style="--card-delay:${index * 120}ms; --badge-color:${earnedRarity.color}; --badge-soft:${earnedRarity.soft};">
            <span>${escapeHtml(earned.icon || "◆")}</span>
            <div>
              <strong>${escapeHtml(earned.name)}${earned.isNew ? " · NEW" : ""}</strong>
              <small>${escapeHtml(earnedRarity.label)} · +${formatNumber(earned.value || 0)} Glyphs</small>
            </div>
          </article>
        `;
      })
      .join("");
    const wordChips = Array.isArray(result.words) && result.words.length
      ? result.words.slice(0, 5).map(({ word }) => `<span>${escapeHtml(word)}</span>`).join("")
      : "";
    const overlay = document.createElement("div");

    document.querySelectorAll(".rare-cutscene, .badge-cutscene").forEach((node) => node.remove());
    overlay.className = `rare-cutscene alpha-core-cutscene ${badge.rarity} tier-${tier} variant-${variant.id} cutscene-level-${derived.cutsceneLevel} cutscene-grade-${profile.id}${isExtreme ? " extreme" : ""}`;
    overlay.style.setProperty("--cutscene-color", rarity.color);
    overlay.style.setProperty("--cutscene-soft", rarity.soft);
    overlay.style.setProperty("--hold-scale", "0");
    overlay.style.setProperty("--sync", "0");
    overlay.style.setProperty("--node-count", String(coreNodeCount));
    overlay.dataset.stage = "incoming";
    overlay.innerHTML = `
      <div class="cutscene-stars" aria-hidden="true"></div>
      <div class="cutscene-noise" aria-hidden="true"></div>
      <div class="cutscene-beam" aria-hidden="true"></div>
      <div class="cutscene-card">
        <div class="cutscene-ring one" aria-hidden="true"></div>
        <div class="cutscene-ring two" aria-hidden="true"></div>
        <div class="cutscene-status">
          <span>${preview ? "ADMIN PREVIEW" : "CORE CUTSCENE"}</span>
          <b>${escapeHtml(profile.title)}</b>
        </div>
        <div class="cutscene-rarity-rail" aria-hidden="true">
          <span data-rail-stage="incoming">Incoming</span>
          <span data-rail-stage="sequence">Lock</span>
          <span data-rail-stage="stabilize">Charge</span>
          <span data-rail-stage="revealed">Reveal</span>
        </div>
        <div class="cutscene-stage-copy">
          <span class="cutscene-kicker">SIGNAL INCOMING</span>
          <h2>${escapeHtml(variant.openingTitle)}</h2>
          <p>${escapeHtml(variant.openingCopy)}</p>
        </div>
        <div class="cutscene-sequence">${sequenceTiles}</div>
        <div class="cutscene-core">
          <div class="cutscene-node-bank left">${leftNodes}</div>
          <div class="cutscene-badge-orb">${escapeHtml(badge.icon || "◆")}</div>
          <div class="cutscene-node-bank right">${rightNodes}</div>
        </div>
        <button class="cutscene-hold-button" type="button" disabled>
          <i aria-hidden="true"></i>
          <span>Waiting for sequence lock...</span>
        </button>
        <section class="cutscene-reveal-panel" aria-live="polite">
          <span class="cutscene-reveal-label">${escapeHtml(rarity.label)} BADGE UNSEALED</span>
          <h2>${escapeHtml(badge.name)}</h2>
          <p>${escapeHtml(badge.description || "A rare badge has entered the archive.")}</p>
          ${wordChips ? `<div class="cutscene-word-strip"><small>WORDS DETECTED</small><div>${wordChips}</div></div>` : ""}
          <div class="cutscene-badge-constellation">${badgeCards}</div>
          <strong>${escapeHtml(TIER_LABELS[tier] || tier)} · +${formatNumber(result.glyphsEarned || 0)} Glyphs</strong>
          <button class="cutscene-claim-button" type="button">${escapeHtml(profile.closeLabel)}</button>
        </section>
        <button class="cutscene-skip-button" type="button">Skip to reveal</button>
      </div>
    `;

    const timeouts = [];
    let holdFrame = 0;
    let holdStart = 0;
    let syncCount = 0;
    let revealed = false;
    let closed = false;
    const stageCopy = overlay.querySelector(".cutscene-stage-copy");
    const tileEls = [...overlay.querySelectorAll(".cutscene-sequence span")];
    const holdButton = overlay.querySelector(".cutscene-hold-button");
    const holdText = holdButton.querySelector("span");
    const syncNodes = [...overlay.querySelectorAll(".cutscene-focus-node")];
    const railSteps = [...overlay.querySelectorAll(".cutscene-rarity-rail span")];
    const claimButton = overlay.querySelector(".cutscene-claim-button");
    const skipButton = overlay.querySelector(".cutscene-skip-button");

    const queue = (callback, delay) => {
      const timeout = setTimeout(callback, delay);
      timeouts.push(timeout);
      return timeout;
    };

    const setStage = (stage, kicker, title, copy) => {
      overlay.dataset.stage = stage;
      const stageOrder = ["incoming", "sequence", "stabilize", "synced", "revealed"];
      const stageIndex = stageOrder.indexOf(stage);
      railSteps.forEach((step) => {
        const railStage = step.dataset.railStage || "incoming";
        const railIndex = stageOrder.indexOf(railStage);
        const isSyncedCharge = stage === "synced" && railStage === "stabilize";
        step.classList.toggle("active", railStage === stage || isSyncedCharge);
        step.classList.toggle("complete", railIndex >= 0 && stageIndex >= 0 && railIndex < stageIndex);
      });
      stageCopy.innerHTML = `
        <span class="cutscene-kicker">${escapeHtml(kicker)}</span>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(copy)}</p>
      `;
    };
    setStage("incoming", "SIGNAL INCOMING", variant.openingTitle, variant.openingCopy);

    const cleanupHold = () => {
      if (holdFrame) cancelAnimationFrame(holdFrame);
      holdFrame = 0;
      holdStart = 0;
      overlay.classList.remove("holding");
    };

    const close = () => {
      if (closed) return;
      closed = true;
      cleanupHold();
      timeouts.forEach(clearTimeout);
      document.removeEventListener("keydown", onKeydown);
      overlay.classList.add("closing");
      setTimeout(() => overlay.remove(), 360);
    };

    const reveal = () => {
      if (revealed || closed) return;
      revealed = true;
      cleanupHold();
      overlay.style.setProperty("--hold-scale", "1");
      overlay.classList.add("revealed");
      setStage("revealed", "ARCHIVE OPEN", badge.name, badge.description || "A rare badge has entered the archive.");
      holdButton.disabled = true;
      holdText.textContent = "Signal opened";
      skipButton.textContent = preview ? "Close preview" : "Close cutscene";
      playTone(tier === "glitched" ? "glitch" : "cutscene");
      queue(() => playTone("rare"), 160);
      queue(() => playTone("upgrade"), 360);
      launchConfetti(tier);
      claimButton.focus();
    };

    const updateHold = (now) => {
      if (!holdStart) holdStart = now;
      const syncedBoost = syncCount >= syncNodes.length ? 0.72 : 1;
      const progress = clamp((now - holdStart) / (holdDuration * syncedBoost), 0, 1);
      overlay.style.setProperty("--hold-scale", progress.toFixed(3));
      if (progress >= 1) {
        reveal();
        return;
      }
      holdFrame = requestAnimationFrame(updateHold);
    };

    const beginHold = (event) => {
      if (holdButton.disabled || revealed || closed) return;
      event.preventDefault();
      cleanupHold();
      overlay.classList.add("holding");
      holdText.textContent = syncCount >= syncNodes.length ? "Opening synced rift..." : "Stabilizing signal...";
      holdFrame = requestAnimationFrame(updateHold);
    };

    const cancelHold = () => {
      if (revealed || closed) return;
      cleanupHold();
      overlay.style.setProperty("--hold-scale", "0");
      if (!holdButton.disabled) {
        holdText.textContent = syncCount >= syncNodes.length ? "Synced — hold to open" : "Hold to reveal";
      }
    };

    const onKeydown = (event) => {
      if (event.key === "Escape") close();
    };

    syncNodes.forEach((node) => {
      node.addEventListener("click", () => {
        if (node.classList.contains("charged") || revealed || closed) return;
        node.classList.add("charged");
        syncCount += 1;
        overlay.style.setProperty("--sync", String(syncCount));
        playTone(syncCount >= syncNodes.length ? "upgrade" : "tick");
        if (syncCount >= syncNodes.length) {
          overlay.classList.add("synced");
          if (!holdButton.disabled) holdText.textContent = "Synced — hold to open";
          setStage("synced", variant.syncedKicker, variant.syncedTitle, variant.syncedCopy);
        }
      });
    });

    holdButton.addEventListener("pointerdown", beginHold);
    holdButton.addEventListener("pointerup", cancelHold);
    holdButton.addEventListener("pointercancel", cancelHold);
    holdButton.addEventListener("pointerleave", cancelHold);
    holdButton.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") beginHold(event);
    });
    holdButton.addEventListener("keyup", (event) => {
      if (event.key === "Enter" || event.key === " ") cancelHold();
    });
    claimButton.addEventListener("click", close);
    skipButton.addEventListener("click", () => {
      if (!revealed) reveal();
      else close();
    });
    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(overlay);

    queue(() => {
      setStage("sequence", variant.sequenceKicker, variant.sequenceTitle, variant.sequenceCopy);
      playTone("rare");
    }, 420);

    tileEls.forEach((tile, index) => {
      queue(() => {
        tile.classList.add("revealed");
        playTone(index === tileEls.length - 1 ? "reward" : "tick");
      }, 780 + index * profile.tileDelay);
    });

    queue(() => {
      overlay.classList.add("ready");
      holdButton.disabled = false;
      holdText.textContent = syncCount >= syncNodes.length ? "Synced — hold to open" : "Hold to reveal";
      if (syncCount >= syncNodes.length) {
        setStage("synced", variant.syncedKicker, variant.syncedTitle, variant.syncedCopy);
      } else {
        setStage("stabilize", variant.stabilizeKicker, variant.stabilizeTitle, variant.stabilizeCopy);
      }
      if (preview) holdButton.focus();
    }, 1100 + sequenceChars.length * profile.tileDelay);
  }

  function previewAdminCutscene() {
    if (!hasAdminPowers()) {
      showToast("Admin preview is only available to admin accounts.", "error");
      return;
    }

    const badges = [
      {
        id: "preview_glitched",
        name: "Admin Preview: Rift Collapse",
        description: "A safe preview of the full interactive core cutscene.",
        rarity: "glitched",
        value: 25000,
        icon: "GX",
        isNew: true,
      },
      {
        id: "preview_mythic",
        name: "Mythic Signal",
        description: "A mythic-grade badge reveal nested inside the rift.",
        rarity: "mythic",
        value: 12000,
        icon: "MY",
        isNew: true,
      },
      {
        id: "preview_legendary",
        name: "Legend Locked",
        description: "The archive recognizes a legendary roll pattern.",
        rarity: "legendary",
        value: 7777,
        icon: "LG",
        isNew: true,
      },
    ];
    const result = {
      sequence: "ALPHA7ZXQ",
      tier: "glitched",
      glyphsEarned: 77777,
      words: [{ word: "ALPHA", start: 0, length: 5, source: "preview" }],
      earnedBadges: badges,
    };
    showBadgeCutscene(result, badges[0], true);
    launchConfetti("glitched");
    playTone("rare");
  }

  function showBadgeCutscene(result, badge, preview = false) {
    const profile = getCutsceneEscalationProfile(badge, result);
    if (profile.core || shouldShowCoreCutscene(result, badge, preview)) {
      showCoreCutscene(result, badge, preview);
      return;
    }

    const style = getCutsceneStyleForBadge(badge);
    const rarity = RARITIES[badge.rarity] || RARITIES.epic;
    const parts = getRollParts(result);
    const source = isNumberBadge(badge) ? parts.numberSequence : parts.letterSequence;
    const tiles = [...(source || result.sequence || "ALPHA")]
      .map((char, index) => `<span style="--tile-delay:${index * 80}ms">${escapeHtml(char)}</span>`)
      .join("");
    const valueText = isNumberBadge(badge)
      ? `+${Number(badge.numberMultiplier || 0).toFixed(2)}x digit multiplier`
      : `+${formatNumber(badge.value || 0)} Glyph badge`;
    const shardButtons = Array.from({ length: profile.shardCount }, (_, index) => `
      <button class="badge-scene-shard" type="button" aria-label="Charge reveal shard ${index + 1}">
        <span>${index + 1}</span>
      </button>
    `).join("");
    const overlay = document.createElement("div");

    document.querySelectorAll(".badge-cutscene").forEach((node) => node.remove());
    overlay.className = `badge-cutscene scene-${style.id} rarity-${badge.rarity} cutscene-grade-${profile.id} locked`;
    overlay.style.setProperty("--scene-color", style.color);
    overlay.style.setProperty("--cutscene-color", rarity.color);
    overlay.innerHTML = `
      <div class="badge-scene-backdrop" aria-hidden="true"></div>
      <section class="badge-scene-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(badge.name)} cutscene">
        <button class="badge-scene-close" type="button" aria-label="Close cutscene">×</button>
        <div class="badge-scene-header">
          <span>${preview ? "PREVIEW" : "VERY RARE BADGE"}</span>
          <b>${escapeHtml(rarity.label)}</b>
        </div>
        <div class="badge-scene-stage">
          <div class="badge-scene-orbit" aria-hidden="true"></div>
          <div class="badge-scene-icon">${escapeHtml(badge.icon || style.icon)}</div>
          <div class="badge-scene-tiles">${tiles}</div>
        </div>
        <div class="badge-scene-copy">
          <small>${escapeHtml(style.name)}</small>
          <h2>${escapeHtml(badge.name)}</h2>
          <p>${escapeHtml(badge.description || style.copy)}</p>
          <strong>${escapeHtml(valueText)}</strong>
        </div>
        <div class="badge-scene-interact">
          <div class="badge-scene-lockline">
            <span>Shard sync</span>
            <b>0 / ${profile.shardCount}</b>
          </div>
          <div class="badge-scene-shards">${shardButtons}</div>
        </div>
        <div class="badge-scene-actions">
          <button class="badge-scene-claim" type="button" disabled>${escapeHtml(profile.actionLabel)}</button>
        </div>
      </section>
    `;

    const shardEls = [...overlay.querySelectorAll(".badge-scene-shard")];
    const lockCounter = overlay.querySelector(".badge-scene-lockline b");
    const claimButton = overlay.querySelector(".badge-scene-claim");
    let chargedShards = 0;

    const close = () => {
      overlay.classList.add("closing");
      setTimeout(() => overlay.remove(), 320);
    };

    const unlock = () => {
      overlay.classList.remove("locked");
      overlay.classList.add("unlocked");
      claimButton.disabled = false;
      claimButton.textContent = preview ? "Close preview" : profile.closeLabel;
      playTone("upgrade");
      launchConfetti(badge.rarity);
    };

    shardEls.forEach((shard) => {
      shard.addEventListener("click", () => {
        if (shard.classList.contains("charged")) return;
        shard.classList.add("charged");
        chargedShards += 1;
        lockCounter.textContent = `${chargedShards} / ${profile.shardCount}`;
        playTone(chargedShards >= profile.shardCount ? "rare" : "tick");
        if (chargedShards >= profile.shardCount) unlock();
      });
    });

    overlay.querySelector(".badge-scene-close").addEventListener("click", close);
    claimButton.addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    document.body.appendChild(overlay);
    playTone(badge.rarity === "glitched" ? "glitch" : "cutscene");
    setTimeout(() => overlay.classList.add("revealed"), 80);
  }

  function showRareCutscene(result, badge, preview = false) {
    const rarity = RARITIES[badge.rarity] || RARITIES.rare;
    const sequenceTiles = [...result.sequence]
      .map((char, index) => `<span style="--tile-delay:${index * 75}ms">${escapeHtml(char)}</span>`)
      .join("");
    const overlay = document.createElement("div");
    overlay.className = `rare-cutscene ${badge.rarity}`;
    overlay.style.setProperty("--cutscene-color", rarity.color);
    overlay.style.setProperty("--cutscene-soft", rarity.soft);
    overlay.innerHTML = `
      <div class="cutscene-stars" aria-hidden="true"></div>
      <div class="cutscene-beam" aria-hidden="true"></div>
      <div class="cutscene-card">
        <div class="cutscene-ring one" aria-hidden="true"></div>
        <div class="cutscene-ring two" aria-hidden="true"></div>
        <span class="cutscene-kicker">${preview ? "ADMIN PREVIEW" : "RARE SIGNAL DETECTED"}</span>
        <div class="cutscene-sequence">${sequenceTiles}</div>
        <div class="cutscene-badge-orb">${escapeHtml(badge.icon)}</div>
        <h2>${escapeHtml(badge.name)}</h2>
        <p>${escapeHtml(badge.description || "A rare badge has entered the archive.")}</p>
        <strong>${escapeHtml(TIER_LABELS[result.tier] || result.tier)} · +${formatNumber(result.glyphsEarned)} Glyphs</strong>
        <button type="button">Continue</button>
      </div>
    `;

    const close = () => {
      overlay.classList.add("closing");
      setTimeout(() => overlay.remove(), 360);
    };
    overlay.querySelector("button").addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    document.body.appendChild(overlay);
    setTimeout(close, preview ? 5200 : 6800);
  }

  function showBadgeBurst(badge) {
    const rarity = RARITIES[badge.rarity] || RARITIES.common;
    const burst = document.createElement("div");
    burst.className = "badge-burst";
    burst.style.setProperty("--burst-color", rarity.color);
    burst.style.setProperty("--burst-soft", rarity.soft);
    burst.innerHTML = `
      <span class="badge-burst-icon">${escapeHtml(badge.icon)}</span>
      <span>
        <small>${badge.isNew ? "NEW BADGE" : "BADGE EARNED"}</small>
        <strong>${escapeHtml(badge.name)}</strong>
      </span>
      <b>+${formatNumber(badge.value)} ◆</b>
    `;

    dom.badgeBurstLayer.appendChild(burst);
    playTone(RARITIES[badge.rarity]?.rank >= 3 || badge.isNew ? "rare" : "reward");
    setTimeout(() => burst.remove(), 1950);
  }

  function showBadgeBurstQueue(result) {
    const alphabetBadges = sortBadgesWorstToBest((result.earnedBadges || []).filter((badge) => !isNumberBadge(badge)));
    const numberBadges = sortBadgesWorstToBest((result.earnedBadges || []).filter(isNumberBadge));
    const alphaLimit = Math.max(4, Math.ceil(BADGE_FEED_LIMIT * 0.62));
    const numberLimit = Math.max(3, BADGE_FEED_LIMIT - alphaLimit);
    const alphabetFeed = buildBadgeFeedItems(alphabetBadges, "alphabet", alphaLimit);
    const numberFeed = buildBadgeFeedItems(numberBadges, "numbers", numberLimit);
    const queue = [
      ...alphabetFeed,
      ...numberFeed,
    ];

    if (!queue.length) return;

    dom.badgeBurstLayer.innerHTML = "";
    const panel = document.createElement("section");
    panel.className = "badge-feed-panel";
    panel.dataset.activeLane = "alphabet";
    panel.innerHTML = `
      <div class="badge-feed-head">
        <div>
          <span>BADGE FEED</span>
          <strong>Worst → Best</strong>
        </div>
        <button type="button" aria-label="Close badge feed">×</button>
      </div>
      <div class="badge-feed-tabs" role="tablist" aria-label="Badge feed lanes">
        <button class="active" type="button" data-feed-tab="alphabet">Alphabet <b>${alphabetBadges.length}</b></button>
        <button type="button" data-feed-tab="numbers">Numbers <b>${numberBadges.length}</b></button>
      </div>
      <div class="badge-feed-stack active" data-feed-stack="alphabet"></div>
      <div class="badge-feed-stack" data-feed-stack="numbers"></div>
    `;

    const setActiveLane = (lane) => {
      panel.dataset.activeLane = lane;
      panel.querySelectorAll("[data-feed-tab]").forEach((button) => {
        button.classList.toggle("active", button.dataset.feedTab === lane);
      });
      panel.querySelectorAll("[data-feed-stack]").forEach((stack) => {
        stack.classList.toggle("active", stack.dataset.feedStack === lane);
      });
    };

    panel.querySelectorAll("[data-feed-tab]").forEach((button) => {
      button.addEventListener("click", () => setActiveLane(button.dataset.feedTab));
    });
    panel.querySelector(".badge-feed-head button").addEventListener("click", () => {
      panel.classList.add("closing");
      setTimeout(() => panel.remove(), 260);
    });

    dom.badgeBurstLayer.appendChild(panel);

    queue.forEach((item, index) => {
      setTimeout(() => {
        const { badge, lane } = item;
        setActiveLane(lane);
        const stack = panel.querySelector(`[data-feed-stack="${lane}"]`);
        if (!stack) return;
        if (item.summary) {
          stack.appendChild(createBadgeFeedSummaryCard(item.count, lane));
        } else {
          stack.appendChild(createBadgeFeedCard(badge, lane));
          playTone(RARITIES[badge.rarity]?.rank >= 3 || badge.isNew ? "rare" : "reward");
        }
      }, index * (LOW_POWER_MODE ? 260 : 340));
    });

    setTimeout(() => {
      if (!panel.isConnected) return;
      panel.classList.add("closing");
      setTimeout(() => panel.remove(), 260);
    }, Math.max(5200, queue.length * (LOW_POWER_MODE ? 260 : 340) + 4300));
  }

  function buildBadgeFeedItems(badges, lane, limit) {
    if (badges.length <= limit) return badges.map((badge) => ({ badge, lane }));

    const lowCount = Math.max(2, Math.floor(limit * 0.38));
    const highCount = Math.max(2, limit - lowCount);
    const hiddenCount = Math.max(0, badges.length - lowCount - highCount);
    return [
      ...badges.slice(0, lowCount).map((badge) => ({ badge, lane })),
      { summary: true, count: hiddenCount, lane },
      ...badges.slice(-highCount).map((badge) => ({ badge, lane })),
    ];
  }

  function sortBadgesWorstToBest(badges) {
    return [...badges].sort((a, b) => {
      const rarityDiff = (RARITIES[a.rarity]?.rank || 0) - (RARITIES[b.rarity]?.rank || 0);
      if (rarityDiff) return rarityDiff;
      const aValue = isNumberBadge(a) ? Number(a.numberMultiplier || 0) : Number(a.value || 0);
      const bValue = isNumberBadge(b) ? Number(b.numberMultiplier || 0) : Number(b.value || 0);
      return aValue - bValue;
    });
  }

  function createBadgeFeedCard(badge, lane) {
    const rarity = RARITIES[badge.rarity] || RARITIES.common;
    const card = document.createElement("article");
    card.className = `badge-feed-card ${lane}`;
    card.style.setProperty("--burst-color", rarity.color);
    card.style.setProperty("--burst-soft", rarity.soft);
    const valueText = isNumberBadge(badge)
      ? `×${(1 + Number(badge.numberMultiplier || 0)).toFixed(2)} boost`
      : `+${formatNumber(badge.value || 0)} Glyphs`;
    card.innerHTML = `
      <span class="badge-burst-icon">${escapeHtml(badge.icon)}</span>
      <span>
        <small>${escapeHtml(rarity.label)}${badge.isNew ? " · NEW" : ""}</small>
        <strong>${escapeHtml(badge.name)}</strong>
      </span>
      <b>${escapeHtml(valueText)}</b>
    `;
    return card;
  }

  function createBadgeFeedSummaryCard(count, lane) {
    const card = document.createElement("article");
    card.className = `badge-feed-card badge-feed-summary ${lane}`;
    card.innerHTML = `
      <span class="badge-burst-icon">+${formatNumber(count)}</span>
      <span>
        <small>ARCHIVED INSTANTLY</small>
        <strong>${formatNumber(count)} more badge${count === 1 ? "" : "s"}</strong>
      </span>
      <b>saved</b>
    `;
    return card;
  }

  function renderEmptyResult() {
    dom.emptyResult.classList.remove("hidden");
    dom.resultContent.classList.add("hidden");
  }

  function renderTiles(sequence, glowingIndexes = []) {
    const parts = getRollParts(sequence);
    const letterCount = parts.letterSequence.length;
    const lanes = createDiceLanes();

    [...parts.letterSequence].forEach((char, index) => {
      const classes = ["revealing"];
      if (glowingIndexes.includes(index)) classes.push("glowing");
      lanes.alphaTiles.appendChild(createTile(char, index, classes));
    });

    [...parts.numberSequence].forEach((char, index) => {
      const globalIndex = letterCount + index;
      const classes = ["revealing", "number-tile"];
      if (glowingIndexes.includes(globalIndex)) classes.push("glowing");
      lanes.numberTiles.appendChild(createTile(char, index, classes));
    });
    return;
    const chars = [...parts.letterSequence, ...parts.numberSequence];
    dom.tileRow.innerHTML = "";
    chars.forEach((char, index) => {
      if (index === letterCount && parts.numberSequence) {
        const bridge = document.createElement("span");
        bridge.className = "roll-bridge";
        bridge.textContent = "×";
        dom.tileRow.appendChild(bridge);
      }
      const classes = ["revealing"];
      if (index >= letterCount) classes.push("number-tile");
      if (glowingIndexes.includes(index)) classes.push("glowing");
      dom.tileRow.appendChild(createTile(char, index, classes));
    });
  }

  function renderPlaceholderTiles() {
    const derived = getDerivedStats();
    const lanes = createDiceLanes();
    for (let index = 0; index < derived.sequenceLength; index += 1) {
      lanes.alphaTiles.appendChild(createTile("?", index, ["placeholder"]));
    }
    for (let index = 0; index < derived.numberSequenceLength; index += 1) {
      lanes.numberTiles.appendChild(createTile("?", index, ["placeholder", "number-tile"]));
    }
    dom.sequencePrompt.textContent = "Your next dual roll is waiting.";
    return;
    const sequenceLength = derived.sequenceLength + derived.numberSequenceLength;
    dom.tileRow.innerHTML = "";
    for (let index = 0; index < sequenceLength; index += 1) {
      if (index === derived.sequenceLength) {
        const bridge = document.createElement("span");
        bridge.className = "roll-bridge";
        bridge.textContent = "×";
        dom.tileRow.appendChild(bridge);
      }
      const classes = ["placeholder"];
      if (index >= derived.sequenceLength) classes.push("number-tile");
      dom.tileRow.appendChild(createTile("?", index, classes));
    }
    dom.sequencePrompt.textContent = "Your next dual roll is waiting.";
  }

  function createTile(char, index, classes = []) {
    const tile = document.createElement("span");
    tile.className = `letter-tile ${classes.join(" ")}`.trim();
    tile.dataset.index = index + 1;
    tile.textContent = char;
    return tile;
  }

  async function shareLastRoll() {
    if (!state.lastResult) return;

    const result = state.lastResult;
    const badgeNames = result.earnedBadges.map((badge) => badge.name).slice(0, 5);
    const summary = [
      `AlphaRNG roll: ${formatRollSequence(result)}`,
      `Tier: ${TIER_LABELS[result.tier]}`,
      `Glyphs: ${formatNumber(result.glyphsEarned)}`,
      `Badges: ${badgeNames.length ? badgeNames.join(", ") : "None"}`,
      "No betting, no money — just alphabet chaos.",
    ].join("\n");

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(summary);
      } else {
        fallbackCopy(summary);
      }
      showToast("Roll summary copied.");
    } catch (error) {
      fallbackCopy(summary);
      showToast("Roll summary copied.");
    }
  }

  function fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function toggleSound() {
    state.settings.sound = !state.settings.sound;
    saveState();
    renderHeader();
    if (state.settings.sound) {
      playTone("reward");
      showToast("Sound enabled.");
    } else {
      showToast("Sound muted.");
    }
  }

  function playTone(type) {
    if (!state.settings.sound) return;

    try {
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      const minGap = type === "tick" ? 55 : type === "reward" ? 85 : 120;
      if (nowMs - lastToneAt < minGap) return;
      lastToneAt = nowMs;

      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const now = audioContext.currentTime;
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();

      const presets = {
        roll: [180, 0.09, "sawtooth", 0.025],
        tick: [520, 0.025, "triangle", 0.012],
        reward: [660, 0.12, "sine", 0.035],
        rare: [880, 0.2, "triangle", 0.045],
        cutscene: [1040, 0.34, "sawtooth", 0.038],
        glitch: [96, 0.26, "square", 0.025],
        upgrade: [740, 0.15, "sine", 0.04],
        error: [140, 0.12, "square", 0.018],
      };

      const [frequency, duration, wave, volume] = presets[type] || presets.reward;
      osc.type = wave;
      osc.frequency.setValueAtTime(frequency, now);
      if (type === "rare" || type === "upgrade" || type === "cutscene") {
        osc.frequency.exponentialRampToValueAtTime(frequency * 1.5, now + duration);
      } else if (type === "glitch") {
        osc.frequency.setValueAtTime(frequency * 2.7, now + duration * 0.45);
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.65), now + duration);
      }
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    } catch (error) {
      // Audio is optional; browser autoplay restrictions should never block play.
    }
  }

  function launchConfetti(tier) {
    if (PREFERS_REDUCED_MOTION) return;
    resizeConfettiCanvas();
    const ctx = dom.confettiCanvas.getContext("2d");
    const baseCount = tier === "glitched" || tier === "mythic" ? 150 : tier === "legendary" ? 120 : 85;
    const count = LOW_POWER_MODE ? Math.floor(baseCount * 0.42) : baseCount;
    const colors = ["#0b6cff", "#16c784", "#ffffff", "#8b5cf6", "#ffcf5c"];

    confettiParticles = Array.from({ length: count }, () => ({
      x: Math.random() * dom.confettiCanvas.width,
      y: -20 - Math.random() * 160,
      size: 4 + Math.random() * 7,
      speed: 2 + Math.random() * 4,
      spin: Math.random() * Math.PI,
      spinSpeed: -0.15 + Math.random() * 0.3,
      drift: -1.4 + Math.random() * 2.8,
      color: colors[randomInt(colors.length)],
      life: 1,
    }));

    if (confettiAnimation) cancelAnimationFrame(confettiAnimation);

    const animate = () => {
      ctx.clearRect(0, 0, dom.confettiCanvas.width, dom.confettiCanvas.height);
      confettiParticles.forEach((particle) => {
        particle.y += particle.speed;
        particle.x += particle.drift;
        particle.spin += particle.spinSpeed;
        particle.life -= 0.006;

        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.spin);
        ctx.globalAlpha = Math.max(particle.life, 0);
        ctx.fillStyle = particle.color;
        ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 0.7);
        ctx.restore();
      });

      confettiParticles = confettiParticles.filter((particle) => particle.life > 0 && particle.y < dom.confettiCanvas.height + 40);
      if (confettiParticles.length) {
        confettiAnimation = requestAnimationFrame(animate);
      } else {
        ctx.clearRect(0, 0, dom.confettiCanvas.width, dom.confettiCanvas.height);
        confettiAnimation = null;
      }
    };

    animate();
  }

  function resizeConfettiCanvas() {
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), LOW_POWER_MODE ? 1.25 : 1.75);
    dom.confettiCanvas.width = Math.floor(window.innerWidth * dpr);
    dom.confettiCanvas.height = Math.floor(window.innerHeight * dpr);
    const ctx = dom.confettiCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function startCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    const tick = () => {
      if (document.hidden) return;
      if (activePage === "roll") renderCooldown();
      if (activePage === "stats") renderNextRollStat();
      if (state.lastResult && activePage === "roll") {
        dom.resultTime.textContent = getRelativeTime(state.lastResult.at);
      }
    };
    tick();
    countdownInterval = setInterval(tick, 1000);
  }

  function getDerivedStats() {
    const luck = 1;

    let cooldownMs = DEFAULT_COOLDOWN_MS;
    const normalCooldownMs = cooldownMs;
    const adminCooldownBypass = hasAdminPowers();
    if (adminCooldownBypass) cooldownMs = 0;

    let sequenceLength = 4;
    if (state.upgrades.bigger_sequence) sequenceLength = 5;
    if (state.upgrades.sequence_expander_2) sequenceLength = 6;

    const numbersUnlocked = true;
    const rollMode = "combo";
    let numberSequenceLength = 2;
    if (state.upgrades.number_sequence_1) numberSequenceLength = 3;
    if (state.upgrades.number_sequence_2) numberSequenceLength = 4;
    if (state.upgrades.number_sequence_3) numberSequenceLength = 6;

    const badgeMultiplier = 1;
    const glyphMultiplier = 1;
    const numberBadgeMultiplier = 1;
    const alphaBadgeMultiplier = 1;
    const autoClaimBonus = 25;
    const cutsceneLevel = 5;

    return {
      luck,
      cooldownMs,
      normalCooldownMs,
      adminCooldownBypass,
      sequenceLength,
      numberSequenceLength,
      rollMode,
      numbersUnlocked,
      mixedMode: numbersUnlocked,
      badgeMultiplier,
      glyphMultiplier,
      numberBadgeMultiplier,
      alphaBadgeMultiplier,
      autoClaim: false,
      autoClaimBonus,
      glowChanceBonus: 0,
      glitchChanceBonus: 0,
      luckSurgeBonus: 0,
      mythicPulseChance: MANUAL_BADGE_DROP_CHANCES.mythic_pulse,
      cutsceneLevel,
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
      cutscene_intensity: true,
      variant_director: true,
      rift_theater: true,
      cutscene_gallery: true,
      epic_projector: true,
      alpha_omega_core: false,
    };
  }

  function getRemainingMs() {
    if (hasAdminPowers()) return 0;
    return Math.max(0, (state.nextRollAt || 0) - Date.now());
  }

  function hasAdminPowers() {
    return Boolean(state.account?.signedIn && isAdminEmail(state.account.email));
  }

  function isAdminEmail(email) {
    return ADMIN_EMAILS.has(String(email || "").trim().toLowerCase());
  }

  function isValidEmailAddress(email) {
    return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(email || "").trim().toLowerCase());
  }

  function getGlowingIndexes(length, derived) {
    const indexes = [];
    const chance = clamp(0.035 * derived.luck + (derived.glowChanceBonus || 0), 0.02, 0.28);
    for (let index = 0; index < length; index += 1) {
      if (Math.random() < chance) indexes.push(index);
    }
    return indexes;
  }

  function isAlternatingVowelConsonant(sequence) {
    if (sequence.length < 4 || !/^[A-Z]+$/.test(sequence)) return false;
    const pattern = [...sequence].map((char) => VOWELS.has(char));
    return pattern.every((isVowel, index) => index === 0 || isVowel !== pattern[index - 1]);
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

  function countCharacters(chars) {
    return chars.reduce((counts, char) => {
      counts[char] = (counts[char] || 0) + 1;
      return counts;
    }, {});
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

  function getDiscoveredBadges() {
    return BADGES.filter((badge) => state.badges[badge.id]);
  }

  function getRarestBadgeId() {
    let rarest = null;
    getDiscoveredBadges().forEach((badge) => {
      if (!rarest) {
        rarest = badge;
        return;
      }
      const badgeRank = RARITIES[badge.rarity].rank;
      const rarestRank = RARITIES[rarest.rarity].rank;
      if (badgeRank > rarestRank || (badgeRank === rarestRank && badge.value > rarest.value)) {
        rarest = badge;
      }
    });
    return rarest?.id || null;
  }

  function getTierRank(tier) {
    return TIER_ORDER.indexOf(tier);
  }

  function getUpgradeName(id) {
    return UPGRADES.find((upgrade) => upgrade.id === id)?.name || id;
  }

  function getPlayerName() {
    return state.account?.signedIn
      ? String(state.account.displayName || "Alpha Roller").slice(0, 22)
      : "Guest";
  }

  function safeFetch(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = { ...(options.headers || {}) };
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && state.account?.csrfToken && !headers["X-CSRF-Token"]) {
      headers["X-CSRF-Token"] = state.account.csrfToken;
    }

    const { timeoutMs = 6000, ...fetchOptions } = { ...options, headers };
    if (typeof fetch === "function") {
      if (!fetchOptions.signal && timeoutMs > 0 && typeof AbortController !== "undefined") {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        fetchOptions.signal = controller.signal;
        return fetch(url, fetchOptions).finally(() => clearTimeout(timeout));
      }
      return fetch(url, fetchOptions);
    }

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(options.method || "GET", url, true);
      xhr.withCredentials = options.credentials === "include";
      xhr.timeout = timeoutMs || 5000;

      Object.entries(headers).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value);
      });

      xhr.onload = () => {
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          json: async () => JSON.parse(xhr.responseText || "{}"),
          text: async () => xhr.responseText || "",
        });
      };
      xhr.onerror = () => reject(new Error("Network request failed"));
      xhr.ontimeout = () => reject(new Error("Network request timed out"));
      xhr.send(options.body || null);
    });
  }

  async function refreshBackendStatus() {
    const candidate = getConfiguredBackendCandidate();
    if (!candidate) {
      backendOnline = false;
      backendHealth = null;
      return false;
    }

    try {
      const response = await safeFetch(buildApiUrl(candidate, "/health"), {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        timeoutMs: 900,
      });
      if (!response.ok) throw new Error(`Health returned ${response.status}`);
      backendHealth = await response.json();
      backendOnline = true;
      return true;
    } catch (error) {
      backendOnline = false;
      backendHealth = null;
      return false;
    }
  }

  async function hydrateBackendSession() {
    const apiBase = getBackendUrl();
    if (!apiBase) return;

    try {
      const [meResponse, leaderboardResponse, progressResponse] = await Promise.all([
        safeFetch(buildApiUrl(apiBase, "/me"), { credentials: "include", cache: "no-store", timeoutMs: 2500 }),
        safeFetch(buildApiUrl(apiBase, "/leaderboard"), { credentials: "include", cache: "no-store", timeoutMs: 2500 }),
        safeFetch(buildApiUrl(apiBase, "/progress"), { credentials: "include", cache: "no-store", timeoutMs: 2500 }),
      ]);

      let signedIn = false;
      if (meResponse.ok) {
        const payload = await meResponse.json();
        if (payload.user) {
          signedIn = true;
          state.account = {
            signedIn: true,
            displayName: payload.user.displayName || "Alpha Roller",
            email: payload.user.email || "",
            isAdmin: Boolean(payload.user.isAdmin) || isAdminEmail(payload.user.email),
            twoStepVerified: true,
            csrfToken: payload.user.csrfToken || "",
          };
        }
      }

      if (signedIn && progressResponse.ok) {
        const payload = await progressResponse.json();
        if (payload.progress) {
          applyCloudProgress(payload.progress);
          state.leaderboard.lastSyncStatus = "Cloud progress loaded";
        } else if (hasMeaningfulProgress()) {
          await saveCloudProgressNow();
          state.leaderboard.lastSyncStatus = "Cloud progress created";
        }
      }

      if (leaderboardResponse.ok) {
        const payload = await leaderboardResponse.json();
        if (Array.isArray(payload.rows)) {
          state.leaderboard.localRows = payload.rows;
          if (payload.boards && typeof payload.boards === "object") state.leaderboard.boards = payload.boards;
          state.leaderboard.lastSyncStatus = "Live leaderboard loaded";
        }
      }

      saveState({ remote: false });
    } catch (error) {
      console.warn("Could not hydrate live backend session.", error);
    }
  }

  function applyCloudProgress(progress) {
    if (!progress || typeof progress !== "object") return;
    const account = state.account;
    const leaderboard = state.leaderboard;
    const settings = state.settings;
    state = normalizeState({
      ...state,
      ...progress,
      account,
      leaderboard,
      settings,
    });
  }

  function hasMeaningfulProgress() {
    return Boolean(
      state.totalRolls ||
      state.totalGlyphs ||
      state.glyphs ||
      Object.keys(state.badges || {}).length ||
      Object.keys(state.upgrades || {}).length ||
      state.bestRoll
    );
  }

  function getCloudProgressPayload() {
    return {
      version: state.version,
      glyphs: state.glyphs,
      totalGlyphs: state.totalGlyphs,
      totalRolls: state.totalRolls,
      lastRollAt: state.lastRollAt,
      nextRollAt: state.nextRollAt,
      badges: state.badges,
      upgrades: state.upgrades,
      bestRoll: state.bestRoll,
      rarestBadgeId: state.rarestBadgeId,
      lastResult: state.lastResult,
    };
  }

  function queueCloudProgressSave() {
    if (progressSaveTimer) clearTimeout(progressSaveTimer);
    progressSaveTimer = setTimeout(() => {
      progressSaveTimer = null;
      saveCloudProgressNow();
    }, 600);
  }

  async function saveCloudProgressNow() {
    const apiBase = getBackendUrl();
    if (!apiBase || !state.account?.signedIn) return false;
    try {
      const response = await safeFetch(buildApiUrl(apiBase, "/progress"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        timeoutMs: 5000,
        body: JSON.stringify({ progress: getCloudProgressPayload() }),
      });
      if (!response.ok) throw new Error(`Progress save returned ${response.status}`);
      return true;
    } catch (error) {
      console.warn("Could not save cloud progress yet.", error);
      return false;
    }
  }

  function handleAuthRedirectNotice() {
    const params = new URLSearchParams(location.search);
    const auth = params.get("auth");
    if (!auth) return;

    if (auth === "magic") showToast("Signed in with magic link. Progress is synced to your account.");
    if (auth === "expired") showToast("That magic link expired. Send a new one.", "error");
    history.replaceState(null, "", `${location.pathname}${location.hash || "#account"}`);
  }

  function getBackendUrl() {
    const candidate = getConfiguredBackendCandidate();
    return backendOnline ? candidate : "";
  }

  function getConfiguredBackendCandidate() {
    return normalizeBackendUrl(
      state.settings?.apiBase ||
      window.AlphaRNGConfig?.apiBase ||
      localStorage.getItem(BACKEND_CONFIG_KEY) ||
      DEFAULT_API_BASE
    );
  }

  function normalizeBackendUrl(url) {
    const trimmed = String(url || "").trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("/")) return trimmed.replace(/\/$/, "");
    try {
      const parsed = new URL(trimmed);
      if (!/^https?:$/.test(parsed.protocol)) return "";
      return parsed.href.replace(/\/$/, "");
    } catch (error) {
      return "";
    }
  }

  function buildApiUrl(apiBase, path) {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return apiBase.startsWith("/") ? `${apiBase}${cleanPath}` : `${apiBase}${cleanPath}`;
  }

  function randomChar(alphabet) {
    return alphabet[randomInt(alphabet.length)];
  }

  function randomInt(max) {
    if (window.crypto?.getRandomValues && max > 0) {
      const array = new Uint32Array(1);
      window.crypto.getRandomValues(array);
      return array[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return cloneDefaultState();
      const saved = JSON.parse(raw);
      return normalizeState(saved);
    } catch (error) {
      console.warn("AlphaRNG save could not be loaded; starting fresh.", error);
      return cloneDefaultState();
    }
  }

  function normalizeState(saved) {
    const baseState = cloneDefaultState();
    const normalized = {
      ...baseState,
      ...saved,
      badges: { ...baseState.badges, ...(saved.badges || {}) },
      upgrades: { ...baseState.upgrades, ...(saved.upgrades || {}) },
      account: { ...baseState.account, ...(saved.account || {}) },
      leaderboard: { ...baseState.leaderboard, ...(saved.leaderboard || {}) },
      settings: { ...baseState.settings, ...(saved.settings || {}) },
    };

    normalized.glyphs = Math.max(0, Number(normalized.glyphs) || 0);
    normalized.totalGlyphs = Math.max(0, Number(normalized.totalGlyphs) || 0);
    normalized.totalRolls = Math.max(0, Number(normalized.totalRolls) || 0);
    normalized.nextRollAt = Math.max(0, Number(normalized.nextRollAt) || 0);
    normalized.lastRollAt = Math.max(0, Number(normalized.lastRollAt) || 0);
    normalized.upgrades = sanitizeActiveUpgrades(normalized.upgrades);
    normalized.settings.apiBase = normalizeBackendUrl(
      normalized.settings.apiBase || localStorage.getItem(BACKEND_CONFIG_KEY) || ""
    );
    normalized.account.displayName = String(normalized.account.displayName || "Guest").slice(0, 22);
    normalized.account.email = String(normalized.account.email || "");
    normalized.account.isAdmin = isAdminEmail(normalized.account.email);
    normalized.leaderboard.localRows = Array.isArray(normalized.leaderboard.localRows)
      ? normalized.leaderboard.localRows
      : [];
    normalized.leaderboard.boards = normalized.leaderboard.boards && typeof normalized.leaderboard.boards === "object"
      ? normalized.leaderboard.boards
      : {};
    normalized.leaderboard.activeBoard = ["daily", "weekly", "allTime", "topGlyphs", "topRolls"].includes(normalized.leaderboard.activeBoard)
      ? normalized.leaderboard.activeBoard
      : "daily";
    return normalized;
  }

  function sanitizeActiveUpgrades(upgrades) {
    const clean = {};
    Object.entries(upgrades && typeof upgrades === "object" ? upgrades : {}).forEach(([id, owned]) => {
      if (owned === true && ACTIVE_UPGRADE_IDS.has(id)) clean[id] = true;
    });
    return clean;
  }

  function cloneDefaultState() {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function saveState(options = {}) {
    const persistedState = {
      ...state,
      account: {
        ...state.account,
        csrfToken: "",
      },
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(persistedState));
    if (options.remote !== false && state.account?.signedIn) {
      queueCloudProgressSave();
    }
  }

  function formatNumber(value) {
    return new Intl.NumberFormat().format(Math.floor(Number(value) || 0));
  }

  function formatLuck(value) {
    return `${value.toFixed(2)}×`;
  }

  function formatDuration(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function getRelativeTime(timestamp) {
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 5) return "JUST NOW";
    if (seconds < 60) return `${seconds}s ago`.toUpperCase();
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`.toUpperCase();
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`.toUpperCase();
    const days = Math.floor(hours / 24);
    return `${days}d ago`.toUpperCase();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showToast(message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast${type === "error" ? " error" : ""}`;
    toast.textContent = message;
    dom.toastRegion.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(12px)";
      setTimeout(() => toast.remove(), 250);
    }, 2800);
  }
})();
