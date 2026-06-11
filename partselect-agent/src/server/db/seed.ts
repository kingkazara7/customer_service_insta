import { getDb, initSchema } from "./connection";

type ModelRow = [string, string, "refrigerator" | "dishwasher", string];
// model_no, brand, type, display name
const models: ModelRow[] = [
  ["WDT780SAEM1", "Whirlpool", "dishwasher", "Whirlpool Built-In Dishwasher (Stainless)"],
  ["WDT730PAHZ0", "Whirlpool", "dishwasher", "Whirlpool Quiet Dishwasher"],
  ["WDF520PADM7", "Whirlpool", "dishwasher", "Whirlpool Front-Control Dishwasher"],
  ["KDTM354DSS4", "KitchenAid", "dishwasher", "KitchenAid Top-Control Dishwasher"],
  ["FFCD2413US", "Frigidaire", "dishwasher", "Frigidaire 24\" Dishwasher"],
  ["SHPM65Z55N", "Bosch", "dishwasher", "Bosch 500 Series Dishwasher"],
  ["WRS325SDHZ01", "Whirlpool", "refrigerator", "Whirlpool 36\" Side-by-Side Refrigerator"],
  ["WRS325FDAM04", "Whirlpool", "refrigerator", "Whirlpool Side-by-Side Refrigerator"],
  ["WRF555SDFZ09", "Whirlpool", "refrigerator", "Whirlpool French Door Refrigerator"],
  ["ED5VHEXVB01", "Whirlpool", "refrigerator", "Whirlpool Side-by-Side Refrigerator (Classic)"],
  ["GSS25GSHSS", "GE", "refrigerator", "GE 25 cu. ft. Side-by-Side Refrigerator"],
  ["RF28R7351SR", "Samsung", "refrigerator", "Samsung French Door Refrigerator"],
];

type PartRow = {
  part_no: string;
  mfr: string;
  name: string;
  desc: string;
  type: "refrigerator" | "dishwasher";
  brand: string;
  price: number;
  stock: number;
  symptoms: string;
  fits: string[]; // compatible model numbers
};

const parts: PartRow[] = [
  // ── Refrigerator parts ─────────────────────────────────────
  {
    part_no: "PS11752778", mfr: "WPW10321304",
    name: "Refrigerator Door Shelf Bin",
    desc: "Clear door shelf bin with white trim. Mounts on the inside of the refrigerator door and holds condiment bottles and jars. Genuine Whirlpool part.",
    type: "refrigerator", brand: "Whirlpool", price: 36.18, stock: 24,
    symptoms: "cracked door bin, door bin falling off, broken door shelf",
    fits: ["WRS325SDHZ01", "WRS325FDAM04", "ED5VHEXVB01"],
  },
  {
    part_no: "PS11770704", mfr: "W10882923",
    name: "Ice Maker Assembly",
    desc: "Complete ice maker module including motor and control arm. The usual replacement when the ice maker produces no ice while water supply is confirmed working.",
    type: "refrigerator", brand: "Whirlpool", price: 128.95, stock: 7,
    symptoms: "ice maker not working, no ice production, low ice output",
    fits: ["WRS325SDHZ01", "WRS325FDAM04", "WRF555SDFZ09", "ED5VHEXVB01"],
  },
  {
    part_no: "PS11749909", mfr: "WPW10408179",
    name: "Water Inlet Valve",
    desc: "Dual-coil inlet valve controlling water supply to the ice maker and dispenser. First thing to check when the ice maker gets no water or the dispenser stops working.",
    type: "refrigerator", brand: "Whirlpool", price: 42.5, stock: 15,
    symptoms: "ice maker not working, ice maker not filling, water dispenser not working, leaking water",
    fits: ["WRS325SDHZ01", "WRS325FDAM04", "WRF555SDFZ09", "ED5VHEXVB01"],
  },
  {
    part_no: "PS9493452", mfr: "EDR1RXD1",
    name: "Refrigerator Water Filter (Filter 1)",
    desc: "Genuine water filter, replace every 6 months. A clogged filter slows ice production and causes small or bad-tasting ice cubes.",
    type: "refrigerator", brand: "Whirlpool", price: 54.99, stock: 48,
    symptoms: "small ice cubes, slow ice production, bad tasting water, ice maker not working",
    fits: ["WRS325SDHZ01", "WRS325FDAM04", "WRF555SDFZ09"],
  },
  {
    part_no: "PS11749598", mfr: "WPW10189703",
    name: "Evaporator Fan Motor",
    desc: "Circulates cold air from the freezer to the fresh-food section. When it fails the refrigerator stops cooling and the freezer gets noisy.",
    type: "refrigerator", brand: "Whirlpool", price: 89.95, stock: 9,
    symptoms: "refrigerator not cooling, loud noise from freezer, humming noise",
    fits: ["WRS325SDHZ01", "WRS325FDAM04", "ED5VHEXVB01"],
  },
  {
    part_no: "PS11739232", mfr: "WPW10225581",
    name: "Defrost Thermostat (Bimetal)",
    desc: "Key sensor of the defrost system. When it fails the evaporator frosts over, blocking airflow and reducing cooling.",
    type: "refrigerator", brand: "Whirlpool", price: 24.1, stock: 21,
    symptoms: "refrigerator not cooling, frost buildup on evaporator, ice on back wall",
    fits: ["WRS325SDHZ01", "ED5VHEXVB01", "WRS325FDAM04"],
  },
  {
    part_no: "PS11740365", mfr: "WPW10583800",
    name: "Temperature Control Thermostat",
    desc: "Fresh-food compartment thermostat that controls compressor cycling.",
    type: "refrigerator", brand: "Whirlpool", price: 95.2, stock: 3,
    symptoms: "refrigerator not cooling, temperature fluctuating, compressor not starting",
    fits: ["ED5VHEXVB01", "WRS325FDAM04"],
  },
  {
    part_no: "PS11741245", mfr: "WPW10613606",
    name: "Compressor Start Relay",
    desc: "Compressor starting device. When it fails the refrigerator stops cooling entirely and makes a clicking sound.",
    type: "refrigerator", brand: "Whirlpool", price: 33.4, stock: 18,
    symptoms: "refrigerator not cooling, clicking sound, compressor not starting",
    fits: ["WRS325SDHZ01", "WRS325FDAM04", "WRF555SDFZ09", "ED5VHEXVB01"],
  },
  {
    part_no: "PS11754026", mfr: "WPW10321358",
    name: "Crisper Drawer",
    desc: "Clear produce crisper drawer.",
    type: "refrigerator", brand: "Whirlpool", price: 64.95, stock: 0, // out-of-stock demo
    symptoms: "cracked drawer, broken drawer rail",
    fits: ["WRS325SDHZ01", "WRS325FDAM04"],
  },
  {
    part_no: "PS11756250", mfr: "W10822635",
    name: "Condenser Fan Motor",
    desc: "Cools the condenser coil. When it fails the compressor overheats and the refrigerator cycles off intermittently.",
    type: "refrigerator", brand: "Whirlpool", price: 76.4, stock: 11,
    symptoms: "refrigerator not cooling, compressor overheating, loud running noise",
    fits: ["WRS325SDHZ01", "WRF555SDFZ09"],
  },
  {
    part_no: "PS12364199", mfr: "W11043011",
    name: "Refrigerator Door Gasket",
    desc: "Magnetic door seal. A bad seal causes frost buildup and higher energy use.",
    type: "refrigerator", brand: "Whirlpool", price: 78.3, stock: 6,
    symptoms: "door not sealing, frost buildup, cold air leaking",
    fits: ["WRF555SDFZ09", "WRS325SDHZ01"],
  },
  {
    part_no: "PS16555101", mfr: "WR60X10185",
    name: "GE Evaporator Fan Motor",
    desc: "Cold-air circulation fan for GE side-by-side refrigerators.",
    type: "refrigerator", brand: "GE", price: 84.6, stock: 8,
    symptoms: "refrigerator not cooling, loud noise from freezer",
    fits: ["GSS25GSHSS"],
  },
  {
    part_no: "PS12172990", mfr: "DA97-12540G",
    name: "Samsung Ice Maker Assembly",
    desc: "Ice maker module for Samsung French door refrigerators.",
    type: "refrigerator", brand: "Samsung", price: 156.8, stock: 5,
    symptoms: "ice maker not working, no ice production, ice maker freezing up",
    fits: ["RF28R7351SR"],
  },

  // ── Dishwasher parts ──────────────────────────────────────
  {
    part_no: "PS10065979", mfr: "W10712395",
    name: "Upper Rack Adjuster Kit",
    desc: "Complete height adjuster kit for the upper dish rack (left and right) with wheel mounts and clips. Replace when the rack sags or won't lock in position.",
    type: "dishwasher", brand: "Whirlpool", price: 39.95, stock: 32,
    symptoms: "upper rack sagging, rack adjuster broken, rack falling off track",
    fits: ["WDT780SAEM1", "WDT730PAHZ0", "KDTM354DSS4"],
  },
  {
    part_no: "PS11722152", mfr: "W10195416",
    name: "Lower Dishrack Wheel",
    desc: "Lower dish rack roller assembly, sold individually. Snap-on installation, no tools needed.",
    type: "dishwasher", brand: "Whirlpool", price: 11.95, stock: 56,
    symptoms: "rack hard to pull out, wheel fell off, broken roller",
    fits: ["WDT780SAEM1", "WDT730PAHZ0", "WDF520PADM7", "KDTM354DSS4"],
  },
  {
    part_no: "PS11756710", mfr: "W10518394",
    name: "Heating Element",
    desc: "Ring-shaped heating element at the tub bottom. Heats wash water and dries dishes — the most common cause of dishes coming out wet.",
    type: "dishwasher", brand: "Whirlpool", price: 48.75, stock: 13,
    symptoms: "dishes not drying, poor drying, water not hot",
    fits: ["WDT780SAEM1", "WDT730PAHZ0", "WDF520PADM7"],
  },
  {
    part_no: "PS11757304", mfr: "W10348269",
    name: "Drain Pump",
    desc: "Dishwasher drain pump motor. When jammed or burned out, water stays in the tub and won't drain.",
    type: "dishwasher", brand: "Whirlpool", price: 86.2, stock: 4, // low-stock demo
    symptoms: "dishwasher not draining, standing water in bottom, drain noise",
    fits: ["WDT780SAEM1", "WDT730PAHZ0", "WDF520PADM7"],
  },
  {
    part_no: "PS11748381", mfr: "W10510667",
    name: "Wash Pump Motor Assembly",
    desc: "Main circulation pump. When it fails the spray arms get no pressure and dishes come out dirty.",
    type: "dishwasher", brand: "Whirlpool", price: 142.0, stock: 6,
    symptoms: "dishes not clean, spray arm not spinning, no water pressure, loud running noise",
    fits: ["WDT780SAEM1", "WDT730PAHZ0"],
  },
  {
    part_no: "PS11753379", mfr: "W10619006",
    name: "Door Latch Assembly",
    desc: "Door latch with micro switches. The dishwasher won't start if the latch doesn't engage.",
    type: "dishwasher", brand: "Whirlpool", price: 38.6, stock: 17,
    symptoms: "dishwasher won't start, door not closing, latch clicking",
    fits: ["WDT780SAEM1", "WDF520PADM7"],
  },
  {
    part_no: "PS11722102", mfr: "W10491331",
    name: "Lower Spray Arm",
    desc: "Lower rotating spray arm. Clogged nozzles or a cracked arm leave the bottom rack dirty.",
    type: "dishwasher", brand: "Whirlpool", price: 27.85, stock: 25,
    symptoms: "dishes not clean, spray arm not spinning, cracked spray arm",
    fits: ["WDT780SAEM1", "WDT730PAHZ0", "WDF520PADM7"],
  },
  {
    part_no: "PS11750084", mfr: "W10350376",
    name: "Detergent Dispenser",
    desc: "Detergent and rinse-aid dispenser assembly. If the door doesn't flip open, detergent never reaches the wash.",
    type: "dishwasher", brand: "Whirlpool", price: 58.4, stock: 0, // out-of-stock demo
    symptoms: "detergent not dispensing, dispenser door stuck, rinse aid leaking",
    fits: ["WDT780SAEM1", "WDT730PAHZ0"],
  },
  {
    part_no: "PS11745312", mfr: "W10195039",
    name: "Float Switch",
    desc: "Overfill protection float switch. A false trigger stops the dishwasher from filling.",
    type: "dishwasher", brand: "Whirlpool", price: 19.95, stock: 29,
    symptoms: "not filling with water, stops right after filling, overflowing",
    fits: ["WDT780SAEM1", "WDF520PADM7"],
  },
  {
    part_no: "PS11750093", mfr: "W10872255",
    name: "Dishwasher Water Inlet Valve",
    desc: "Water inlet solenoid valve. When it fails the dishwasher won't fill, or keeps filling after shutoff.",
    type: "dishwasher", brand: "Whirlpool", price: 46.3, stock: 14,
    symptoms: "not filling with water, filling slowly, fills when off, leaking",
    fits: ["WDT780SAEM1", "WDT730PAHZ0", "WDF520PADM7"],
  },
  {
    part_no: "PS11770146", mfr: "W11035180",
    name: "Electronic Control Board",
    desc: "Main control board. Replace when buttons stop responding or cycles run erratically.",
    type: "dishwasher", brand: "Whirlpool", price: 164.5, stock: 2, // low-stock demo
    symptoms: "won't start, buttons not responding, erratic cycles, lights blinking",
    fits: ["WDT780SAEM1"],
  },
  {
    part_no: "PS11769110", mfr: "W10300924",
    name: "Dishwasher Door Seal / Gasket",
    desc: "Perimeter door seal. Hardened seals leak water at the door edges.",
    type: "dishwasher", brand: "Whirlpool", price: 34.2, stock: 22,
    symptoms: "leaking from door, worn door seal, odor",
    fits: ["WDT780SAEM1", "WDT730PAHZ0", "WDF520PADM7"],
  },
  {
    part_no: "PS11746591", mfr: "WPW10082853",
    name: "Silverware Basket",
    desc: "Door-mounted silverware basket with divided lid.",
    type: "dishwasher", brand: "Whirlpool", price: 32.95, stock: 19,
    symptoms: "broken silverware basket, cracked grid",
    fits: ["WDT780SAEM1", "WDF520PADM7"],
  },
  {
    part_no: "PS12348510", mfr: "5304506523",
    name: "Frigidaire Spray Arm Kit",
    desc: "Upper and lower spray arm kit for Frigidaire dishwashers.",
    type: "dishwasher", brand: "Frigidaire", price: 41.7, stock: 10,
    symptoms: "dishes not clean, spray arm not spinning",
    fits: ["FFCD2413US"],
  },
  {
    part_no: "PS16219067", mfr: "00754866",
    name: "Bosch Drain Pump",
    desc: "Drain pump for Bosch 500 series dishwashers.",
    type: "dishwasher", brand: "Bosch", price: 92.3, stock: 7,
    symptoms: "not draining, standing water, E24 error code",
    fits: ["SHPM65Z55N"],
  },
];

type GuideRow = {
  part_no: string;
  difficulty: "easy" | "medium" | "hard";
  minutes: number;
  tools: string;
  steps: string[];
  video?: string;
  manual?: string;
};

const guides: GuideRow[] = [
  {
    part_no: "PS11752778", difficulty: "easy", minutes: 1, tools: "No tools required",
    steps: [
      "Open the refrigerator door and empty the shelf bin",
      "Grip both sides of the bin and lift it straight up off the door liner slots",
      "Align the new bin with the slots on the door liner",
      "Press straight down until it clicks into place",
    ],
    video: "https://www.youtube.com/watch?v=ps11752778-demo",
    manual: "https://www.partselect.com/Installation-Instructions/PS11752778/",
  },
  {
    part_no: "PS10065979", difficulty: "medium", minutes: 30, tools: "Phillips screwdriver",
    steps: [
      "Pull out the upper rack and press the stop clips at the end of both slide rails",
      "Slide the upper rack completely off the rails and set it on a counter",
      "Remove the old adjusters: hold the release button and slide them off",
      "Install the new adjuster kit on both sides of the rack, making sure the clips seat fully",
      "Slide the rack back onto the rails, refit the stop clips, and test the height adjustment",
    ],
    video: "https://www.youtube.com/watch?v=ps10065979-demo",
    manual: "https://www.partselect.com/Installation-Instructions/PS10065979/",
  },
  {
    part_no: "PS11756710", difficulty: "medium", minutes: 45, tools: "Phillips screwdriver, socket wrench, multimeter",
    steps: [
      "Disconnect power to the dishwasher (unplug it or switch off the breaker)",
      "Remove the lower access panel and locate the two heating element terminals",
      "Photograph the wiring, then pull the wire connectors off the terminals",
      "Inside the tub, remove the nuts that secure the heating element",
      "Lift the old element out of the tub and set the new one into the mounting holes",
      "Tighten the nuts, reconnect the wires, restore power, and run a dry cycle to test",
    ],
    video: "https://www.youtube.com/watch?v=ps11756710-demo",
    manual: "https://www.partselect.com/Installation-Instructions/PS11756710/",
  },
  {
    part_no: "PS11757304", difficulty: "medium", minutes: 40, tools: "Phillips screwdriver, pliers, towel",
    steps: [
      "Shut off power and water; lay a towel down to catch residual water",
      "Remove the kick panel and locate the drain pump on the sump",
      "Unplug the pump connector and release the drain hose clamp",
      "Rotate the pump counterclockwise to release it from the sump",
      "Seat the new pump and rotate clockwise to lock; reconnect hose and wiring",
      "Restore power and run a drain cycle to check for leaks",
    ],
    video: "https://www.youtube.com/watch?v=ps11757304-demo",
    manual: "https://www.partselect.com/Installation-Instructions/PS11757304/",
  },
  {
    part_no: "PS11770704", difficulty: "medium", minutes: 25, tools: "Phillips screwdriver, 5/16\" socket",
    steps: [
      "Unplug the refrigerator and remove the ice bucket from the freezer",
      "Remove the two mounting screws under the ice maker, support the body and lift it off the hook",
      "Unplug the wire harness on the back and remove the old ice maker",
      "Connect the harness to the new ice maker, hang it on the hook, and tighten the screws",
      "Restore power and allow 24 hours to confirm normal ice production",
    ],
    video: "https://www.youtube.com/watch?v=ps11770704-demo",
    manual: "https://www.partselect.com/Installation-Instructions/PS11770704/",
  },
  {
    part_no: "PS11749909", difficulty: "medium", minutes: 35, tools: "Phillips screwdriver, 1/4\" socket, adjustable wrench",
    steps: [
      "Unplug the refrigerator and shut off the water supply valve behind it",
      "Pull the refrigerator out and remove the lower rear access panel",
      "Loosen the compression nut on the water line with a wrench",
      "Unplug the solenoid harness and remove the valve mounting screws",
      "Install the new valve, reconnect the water line (do not overtighten) and the harness",
      "Turn the water back on, check the fittings for leaks, and restore power",
    ],
    video: "https://www.youtube.com/watch?v=ps11749909-demo",
    manual: "https://www.partselect.com/Installation-Instructions/PS11749909/",
  },
  {
    part_no: "PS11722152", difficulty: "easy", minutes: 2, tools: "No tools required",
    steps: [
      "Pull out the lower dish rack",
      "Press the center clip of the old wheel and pull it off the axle",
      "Push the new wheel onto the axle until it clicks",
    ],
    manual: "https://www.partselect.com/Installation-Instructions/PS11722152/",
  },
  {
    part_no: "PS9493452", difficulty: "easy", minutes: 2, tools: "No tools required",
    steps: [
      "Locate the filter compartment (upper right of the fresh-food section or in the base grille)",
      "Rotate the old filter a quarter turn counterclockwise and pull it out",
      "Remove the protective cap from the new filter, insert it, and rotate clockwise to lock",
      "Flush about one gallon of water through the dispenser before use",
    ],
    manual: "https://www.partselect.com/Installation-Instructions/PS9493452/",
  },
];

type ChunkRow = {
  source_type: "repair_guide" | "manual" | "transcript";
  part_no?: string;
  appliance_type: "refrigerator" | "dishwasher";
  symptom_tags: string;
  text: string;
  source_url?: string;
  source_ref?: string;
};

const chunks: ChunkRow[] = [
  {
    source_type: "repair_guide", appliance_type: "refrigerator",
    symptom_tags: "ice maker not working, no ice",
    text:
      "Troubleshooting order for a Whirlpool refrigerator ice maker that is not working: 1) Make sure the ice maker control arm/switch is in the ON position; 2) Confirm the freezer is below 10°F (0–5°F is ideal) — the ice maker will not cycle if it is too warm; 3) Check whether the water filter is more than 6 months old; a clogged filter sharply reduces water flow; 4) Listen for the inlet valve filling — if there is no fill sound and house pressure is normal (>20 psi), the water inlet valve (WPW10408179) is likely bad; 5) If all of the above check out and there is still no ice, the ice maker assembly itself (W10882923) has usually failed internally and should be replaced as a unit.",
    source_url: "https://www.partselect.com/Repair/Refrigerator/Ice-Maker-Not-Making-Ice/",
  },
  {
    source_type: "repair_guide", appliance_type: "refrigerator",
    symptom_tags: "ice maker not working, small ice cubes, slow ice production",
    text:
      "Small or hollow ice cubes usually mean insufficient water supply: replace the water filter first (EDR1RXD1), then check household water pressure. If the refrigerator is fed by a saddle valve with weak pressure, each fill will be short and cubes come out small. A partially clogged inlet valve causes the same symptom.",
    source_url: "https://www.partselect.com/Repair/Refrigerator/Small-Ice-Cubes/",
  },
  {
    source_type: "repair_guide", appliance_type: "refrigerator",
    symptom_tags: "refrigerator not cooling, fresh food section warm",
    text:
      "Refrigerator not cooling checklist: 1) Clean the condenser coils (behind the base grille) — dust buildup is the #1 cause; 2) Verify the condenser fan spins freely; 3) If the freezer is cold but the fresh-food section is warm, suspect the evaporator fan motor (WPW10189703) or a frost-blocked air duct; 4) Heavy ice on the back wall points to a defrost system failure — check the defrost thermostat (WPW10225581) first; 5) If the compressor clicks but never starts, replace the start relay (WPW10613606).",
    source_url: "https://www.partselect.com/Repair/Refrigerator/Not-Cooling/",
  },
  {
    source_type: "repair_guide", appliance_type: "dishwasher",
    symptom_tags: "not draining, standing water",
    text:
      "Dishwasher not draining checklist: 1) Clean food debris out of the filter at the bottom of the tub; 2) Check the drain hose for kinks and confirm a high loop under the sink on new installs; 3) If connected to a garbage disposal, confirm the knockout plug was removed from the disposal inlet; 4) Run a drain cycle and listen to the pump: silence or a hum means the drain pump (W10348269) is jammed or burned out and needs replacement. Bosch models showing error E24/E25 indicate the same problem.",
    source_url: "https://www.partselect.com/Repair/Dishwasher/Not-Draining/",
  },
  {
    source_type: "repair_guide", appliance_type: "dishwasher",
    symptom_tags: "dishes not drying, poor drying",
    text:
      "Dishes coming out wet: 1) Make sure rinse aid is filled — missing rinse aid is the top cause of wet plastic items; 2) Select a cycle with heated dry; 3) If dishes are still wet, measure the heating element (W10518394) resistance — expect 15–30 ohms at room temperature; an open circuit means it must be replaced; 4) If the element reads fine, check the heat relay on the control board.",
    source_url: "https://www.partselect.com/Repair/Dishwasher/Dishes-Not-Drying/",
  },
  {
    source_type: "repair_guide", appliance_type: "dishwasher",
    symptom_tags: "not filling with water, fills slowly",
    text:
      "Dishwasher not filling: 1) Confirm the water supply valve under the sink is open; 2) Check whether the float switch (W10195039) is stuck — a float jammed in the high position cuts off filling; 3) An open inlet valve coil (W10872255) or a clogged valve screen causes no fill or slow fill — with power off, the coil should read roughly 500–1500 ohms; 4) The machine will not start at all if the door latch isn't engaged, so check the latch assembly too.",
    source_url: "https://www.partselect.com/Repair/Dishwasher/Not-Filling/",
  },
  {
    source_type: "repair_guide", appliance_type: "dishwasher",
    symptom_tags: "dishes not clean, spray arm not spinning",
    text:
      "Dishes not coming out clean: 1) Check the upper and lower spray arm nozzles for scale or debris — clear them with a toothpick and rinse with warm water; 2) A worn spray arm bearing keeps the arm from spinning; replace the arm; 3) If the arms are fine but pressure is weak, the circulation pump motor (W10510667) is usually worn; 4) Running a dishwasher cleaner regularly prevents scale buildup.",
    source_url: "https://www.partselect.com/Repair/Dishwasher/Not-Cleaning/",
  },
  {
    source_type: "transcript", part_no: "PS11752778", appliance_type: "refrigerator",
    symptom_tags: "door shelf bin installation",
    text:
      "(Installation video transcript excerpt) Hi everyone, today we're replacing the door shelf bin on a Whirlpool refrigerator. You don't need any tools for this one: empty the old bin, grab it on both sides, and lift straight up — it pops right off. Line the new bin up with the two slots on the door liner and press down until you hear the click. The whole job takes under a minute. Just make sure you check your model number when ordering — this bin fits most Whirlpool side-by-side models.",
    source_url: "https://www.youtube.com/watch?v=ps11752778-demo", source_ref: "00:32",
  },
  {
    source_type: "transcript", part_no: "PS11756710", appliance_type: "dishwasher",
    symptom_tags: "heating element replacement, dishes not drying",
    text:
      "(Installation video transcript excerpt) Two things people miss when replacing the heating element: first, the wire terminals are under the base pan, so cut power before you pull the kick panel — verify with a non-contact tester. Second, after feeding the new element through the tub holes, put a tiny dab of dish soap on the rubber seals so they seat properly, then tighten the nuts hand-tight plus a quarter turn. Overtightening cracks the seal and causes leaks. Run a quick rinse cycle afterward and check underneath for drips.",
    source_url: "https://www.youtube.com/watch?v=ps11756710-demo", source_ref: "03:15",
  },
  {
    source_type: "manual", part_no: "PS11770704", appliance_type: "refrigerator",
    symptom_tags: "ice maker installation, ice maker not working",
    text:
      "(Service manual excerpt, p.12) Notes after replacing the ice maker module: on first power-up the module runs an initialization — two blinks of the indicator LED on the front housing are a normal self-test. Discard the first 2–3 batches of ice from a new ice maker. If no ice is produced after 24 hours, check the water line and inlet valve, and confirm the freezer has reached 0°F (-18°C).",
    source_url: "https://www.partselect.com/Installation-Instructions/PS11770704/", source_ref: "p.12",
  },
];

function seed() {
  initSchema();
  const db = getDb();

  const wipe = db.transaction(() => {
    for (const t of [
      "order_items", "orders", "carts", "search_history", "user_appliances",
      "users", "doc_chunks", "install_guides", "compatibility", "parts", "appliance_models",
    ]) db.prepare(`DELETE FROM ${t}`).run();
  });
  wipe();

  const insertAll = db.transaction(() => {
    const insModel = db.prepare(
      "INSERT INTO appliance_models (model_no, brand, appliance_type, name) VALUES (?,?,?,?)"
    );
    const modelIds = new Map<string, number>();
    for (const [model_no, brand, type, name] of models) {
      const r = insModel.run(model_no, brand, type, name);
      modelIds.set(model_no, Number(r.lastInsertRowid));
    }

    const insPart = db.prepare(
      `INSERT INTO parts (part_no, mfr_part_no, name, description, appliance_type, brand, price, stock_qty, product_url, symptoms)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    );
    const insCompat = db.prepare(
      "INSERT INTO compatibility (part_id, model_id) VALUES (?,?)"
    );
    const partIds = new Map<string, number>();
    for (const p of parts) {
      const r = insPart.run(
        p.part_no, p.mfr, p.name, p.desc, p.type, p.brand, p.price, p.stock,
        `https://www.partselect.com/${p.part_no}.htm`, p.symptoms
      );
      const id = Number(r.lastInsertRowid);
      partIds.set(p.part_no, id);
      for (const m of p.fits) {
        const mid = modelIds.get(m);
        if (mid) insCompat.run(id, mid);
      }
    }

    const insGuide = db.prepare(
      `INSERT INTO install_guides (part_id, difficulty, est_time_minutes, tools, steps_json, video_url, manual_url)
       VALUES (?,?,?,?,?,?,?)`
    );
    for (const g of guides) {
      insGuide.run(
        partIds.get(g.part_no)!, g.difficulty, g.minutes, g.tools,
        JSON.stringify(g.steps), g.video ?? null, g.manual ?? null
      );
    }

    const insChunk = db.prepare(
      `INSERT INTO doc_chunks (source_type, part_id, appliance_type, symptom_tags, chunk_text, source_url, source_ref)
       VALUES (?,?,?,?,?,?,?)`
    );
    for (const c of chunks) {
      insChunk.run(
        c.source_type, c.part_no ? partIds.get(c.part_no)! : null,
        c.appliance_type, c.symptom_tags, c.text, c.source_url ?? null, c.source_ref ?? null
      );
    }

    // Demo user: two owned appliances + one past order
    // (powers the appliance-card view and the "previously purchased parts" picker)
    const uid = Number(
      db.prepare("INSERT INTO users (email, name) VALUES (?,?)")
        .run("demo@example.com", "Demo User").lastInsertRowid
    );
    const insUA = db.prepare(
      "INSERT INTO user_appliances (user_id, model_id, source) VALUES (?,?,?)"
    );
    insUA.run(uid, modelIds.get("WDT780SAEM1")!, "purchased");
    insUA.run(uid, modelIds.get("WRS325SDHZ01")!, "purchased");

    const binId = partIds.get("PS11752778")!;
    const oid = Number(
      db.prepare("INSERT INTO orders (user_id, total, status, card_last4) VALUES (?,?,?,?)")
        .run(uid, 36.18, "delivered", "4242").lastInsertRowid
    );
    db.prepare(
      "INSERT INTO order_items (order_id, part_id, qty, unit_price) VALUES (?,?,?,?)"
    ).run(oid, binId, 1, 36.18);
  });
  insertAll();

  const counts = {
    models: models.length,
    parts: parts.length,
    guides: guides.length,
    chunks: chunks.length,
  };
  console.log("Seed complete:", JSON.stringify(counts));
}

seed();
