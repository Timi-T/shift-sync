/**
 * ShiftSync — Database Seed
 *
 * Populates a realistic dataset for Coastal Eats (4 locations, 2 time zones).
 * Covers all 6 evaluation scenarios described in the assessment:
 *
 *   1. Sunday Night Chaos  — marinaSun_evening shift left unassigned
 *   2. Overtime Trap       — Ryan Wilson at 40h; Sat shift would push to 48h
 *   3. Timezone Tangle     — Chris Lee certified at PT + ET locations
 *   4. Simultaneous Assign — seeded concurrently-assignable context
 *   5. Fairness Complaint  — Sarah gets disproportionate premium Sat shifts
 *   6. Regret Swap         — Sarah/Maria swap at PENDING_MANAGER status
 *
 * Run:  npm run db:seed  (from apps/api or repo root)
 *
 * This script is idempotent: run it multiple times on a clean DB without error.
 * It will FAIL if data already exists (use db:reset to wipe first).
 */

import { PrismaClient, Prisma, Role, ShiftStatus, SwapType, SwapStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  addDays,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
  startOfWeek,
  subDays,
} from "date-fns";
import { fromZonedTime } from "date-fns-tz";

const prisma = new PrismaClient();

// =============================================================================
// Constants
// =============================================================================

const TZ = {
  PACIFIC: "America/Los_Angeles",
  EASTERN: "America/New_York",
} as const;

// Monday of the current ISO week is the scheduling anchor.
const WEEK_START = startOfWeek(new Date(), { weekStartsOn: 1 });

// =============================================================================
// Helpers
// =============================================================================

async function hash(password: string) {
  return bcrypt.hash(password, 10);
}

/**
 * Convert a local date + hour + minute to a UTC Date, correctly handling DST.
 * endHour <= startHour means the shift ends the following calendar day.
 */
function toUtc(baseDate: Date, hour: number, minute: number, tz: string): Date {
  const d = setMilliseconds(
    setSeconds(setMinutes(setHours(baseDate, hour), minute), 0),
    0,
  );
  return fromZonedTime(d, tz);
}

async function createShift(opts: {
  id: string;
  locationId: string;
  tz: string;
  skillId: string;
  day: Date;
  start: number;
  end: number;
  headcount?: number;
  status?: ShiftStatus;
  isPremium?: boolean;
  createdBy: string;
}) {
  const startTime = toUtc(opts.day, opts.start, 0, opts.tz);
  const endDay = opts.end <= opts.start ? addDays(opts.day, 1) : opts.day;
  const endTime = toUtc(endDay, opts.end, 0, opts.tz);

  return prisma.shift.upsert({
    where: { id: opts.id },
    update: {},
    create: {
      id: opts.id,
      locationId: opts.locationId,
      skillId: opts.skillId,
      startTime,
      endTime,
      headcount: opts.headcount ?? 1,
      status: opts.status ?? ShiftStatus.PUBLISHED,
      publishedAt:
        opts.status === ShiftStatus.DRAFT ? null : new Date(WEEK_START),
      isPremium: opts.isPremium ?? false,
      createdBy: opts.createdBy,
    },
  });
}

async function assign(shiftId: string, userId: string, managerId: string) {
  return prisma.shiftAssignment.upsert({
    where: { shiftId_userId: { shiftId, userId } },
    update: {},
    create: { shiftId, userId, assignedBy: managerId },
  });
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log("🌱  Starting seed…\n");

  // ── Skills ─────────────────────────────────────────────────────────────────
  console.log("  Skills…");
  const [bartender, lineCook, server, host, barback, prepCook] =
    await Promise.all([
      prisma.skill.upsert({ where: { name: "bartender" }, update: {}, create: { id: "skill_bartender", name: "bartender" } }),
      prisma.skill.upsert({ where: { name: "Line cook" }, update: {}, create: { id: "skill_line_cook", name: "Line cook" } }),
      prisma.skill.upsert({ where: { name: "server" }, update: {}, create: { id: "skill_server", name: "server" } }),
      prisma.skill.upsert({ where: { name: "host" }, update: {}, create: { id: "skill_host", name: "host" } }),
      prisma.skill.upsert({ where: { name: "barback" }, update: {}, create: { id: "skill_barback", name: "barback" } }),
      prisma.skill.upsert({ where: { name: "Prep cook" }, update: {}, create: { id: "skill_prep_cook", name: "Prep cook" } }),
    ] as const);

  // ── Locations ───────────────────────────────────────────────────────────────
  console.log("  Locations…");
  const [marina, boardwalk, heights, garden] = await Promise.all([
    prisma.location.upsert({
      where: { id: "loc_marina" }, update: {},
      create: { id: "loc_marina", name: "The Marina", timezone: TZ.PACIFIC, address: "100 Marina Blvd, San Francisco, CA 94123" },
    }),
    prisma.location.upsert({
      where: { id: "loc_boardwalk" }, update: {},
      create: { id: "loc_boardwalk", name: "The Boardwalk", timezone: TZ.PACIFIC, address: "500 Pacific Ave, Santa Cruz, CA 95060" },
    }),
    prisma.location.upsert({
      where: { id: "loc_heights" }, update: {},
      create: { id: "loc_heights", name: "The Heights", timezone: TZ.EASTERN, address: "200 Riverside Dr, New York, NY 10025" },
    }),
    prisma.location.upsert({
      where: { id: "loc_garden" }, update: {},
      create: { id: "loc_garden", name: "The Garden", timezone: TZ.EASTERN, address: "45 Garden State Pkwy, Newark, NJ 07102" },
    }),
  ] as const);

  // ── Users ───────────────────────────────────────────────────────────────────
  console.log("  Users…");

  const [adminHash, mgr, staffPw] = await Promise.all([
    hash("Admin123!"), hash("Manager123!"), hash("Staff123!"),
  ]);

  const admin = await prisma.user.upsert({
    where: { email: "admin@coastaleats.com" }, update: {},
    create: { id: "user_admin", email: "admin@coastaleats.com", name: "Alex Johnson", passwordHash: adminHash, role: Role.ADMIN },
  });

  const [mgrWest, mgrEast] = await Promise.all([
    prisma.user.upsert({
      where: { email: "tom.garcia@coastaleats.com" }, update: {},
      create: { id: "user_mgr_west", email: "tom.garcia@coastaleats.com", name: "Tom Garcia", passwordHash: mgr, role: Role.MANAGER },
    }),
    prisma.user.upsert({
      where: { email: "lisa.chen@coastaleats.com" }, update: {},
      create: { id: "user_mgr_east", email: "lisa.chen@coastaleats.com", name: "Lisa Chen", passwordHash: mgr, role: Role.MANAGER },
    }),
  ] as const);

  // Staff definitions
  const staff = [
    { id: "user_sarah", email: "sarah.chen@coastaleats.com", name: "Sarah Chen", desired: 30, skills: [server, host], locs: [marina, boardwalk] },
    { id: "user_john", email: "john.martinez@coastaleats.com", name: "John Martinez", desired: 40, skills: [bartender, barback], locs: [marina] },
    { id: "user_maria", email: "maria.rodriguez@coastaleats.com", name: "Maria Rodriguez", desired: 35, skills: [server, bartender], locs: [marina, boardwalk] },
    { id: "user_david", email: "david.kim@coastaleats.com", name: "David Kim", desired: 40, skills: [lineCook, prepCook], locs: [marina] },
    { id: "user_emily", email: "emily.johnson@coastaleats.com", name: "Emily Johnson", desired: 25, skills: [server, host], locs: [boardwalk] },
    { id: "user_michael", email: "michael.brown@coastaleats.com", name: "Michael Brown", desired: 40, skills: [bartender], locs: [boardwalk, marina] },
    // Cross-timezone staff (Scenario 3 — Timezone Tangle)
    { id: "user_chris", email: "chris.lee@coastaleats.com", name: "Chris Lee", desired: 35, skills: [server], locs: [marina, heights] },
    { id: "user_jessica", email: "jessica.taylor@coastaleats.com", name: "Jessica Taylor", desired: 32, skills: [server, host], locs: [heights, garden] },
    { id: "user_ryan", email: "ryan.wilson@coastaleats.com", name: "Ryan Wilson", desired: 40, skills: [lineCook], locs: [heights] },
    { id: "user_amanda", email: "amanda.davis@coastaleats.com", name: "Amanda Davis", desired: 28, skills: [server, host], locs: [heights, garden] },
    { id: "user_james", email: "james.thompson@coastaleats.com", name: "James Thompson", desired: 40, skills: [bartender, barback], locs: [garden] },
    { id: "user_ashley", email: "ashley.martinez@coastaleats.com", name: "Ashley Martinez", desired: 20, skills: [server], locs: [garden] },
    { id: "user_noah", email: "noah.anderson@coastaleats.com", name: "Noah Anderson", desired: 40, skills: [bartender], locs: [heights, garden] },
    { id: "user_olivia", email: "olivia.brown@coastaleats.com", name: "Olivia Brown", desired: 24, skills: [host, server], locs: [boardwalk] },
    { id: "user_daniel", email: "daniel.white@coastaleats.com", name: "Daniel White", desired: 40, skills: [lineCook, prepCook], locs: [heights, garden] },
  ] as const;

  for (const s of staff) {
    const user = await prisma.user.upsert({
      where: { email: s.email }, update: {},
      create: { id: s.id, email: s.email, name: s.name, passwordHash: staffPw, role: Role.STAFF, desiredHoursPerWeek: s.desired },
    });
    for (const skill of s.skills) {
      await prisma.userSkill.upsert({
        where: { userId_skillId: { userId: user.id, skillId: skill.id } },
        update: {}, create: { userId: user.id, skillId: skill.id },
      });
    }
    for (const loc of s.locs) {
      await prisma.locationCertification.upsert({
        where: { userId_locationId: { userId: user.id, locationId: loc.id } },
        update: {}, create: { userId: user.id, locationId: loc.id, certifiedBy: admin.id },
      });
    }
    await prisma.notificationPreference.upsert({
      where: { userId: user.id }, update: {},
      create: { userId: user.id, inApp: true, email: false },
    });
  }

  for (const u of [admin, mgrWest, mgrEast]) {
    await prisma.notificationPreference.upsert({
      where: { userId: u.id }, update: {},
      create: { userId: u.id, inApp: true, email: false },
    });
  }

  // ── Manager → Location ──────────────────────────────────────────────────────
  console.log("  Manager locations…");
  await Promise.all([
    prisma.locationManager.upsert({ where: { userId_locationId: { userId: mgrWest.id, locationId: marina.id } }, update: {}, create: { userId: mgrWest.id, locationId: marina.id } }),
    prisma.locationManager.upsert({ where: { userId_locationId: { userId: mgrWest.id, locationId: boardwalk.id } }, update: {}, create: { userId: mgrWest.id, locationId: boardwalk.id } }),
    prisma.locationManager.upsert({ where: { userId_locationId: { userId: mgrEast.id, locationId: heights.id } }, update: {}, create: { userId: mgrEast.id, locationId: heights.id } }),
    prisma.locationManager.upsert({ where: { userId_locationId: { userId: mgrEast.id, locationId: garden.id } }, update: {}, create: { userId: mgrEast.id, locationId: garden.id } }),
  ]);

  // ── Availability ────────────────────────────────────────────────────────────
  console.log("  Availability windows…");

  const avail: Array<{ userId: string; days: number[]; start: string; end: string }> = [
    { userId: "user_sarah", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" },
    { userId: "user_john", days: [2, 3, 4, 5, 6], start: "16:00", end: "24:00" },
    { userId: "user_maria", days: [0, 1, 2, 3, 4, 5, 6], start: "10:00", end: "23:00" },
    { userId: "user_chris", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" }, // Scenario 3
    { userId: "user_michael", days: [0, 1, 2, 3, 4, 5, 6], start: "08:00", end: "24:00" },
    { userId: "user_david", days: [1, 2, 3, 4, 5], start: "06:00", end: "16:00" },
    { userId: "user_emily", days: [3, 4, 5, 6, 0], start: "11:00", end: "23:00" },
    { userId: "user_olivia", days: [0, 1, 2, 3, 4, 5, 6], start: "10:00", end: "22:00" },
    { userId: "user_ryan", days: [1, 2, 3, 4, 5], start: "08:00", end: "20:00" },
    { userId: "user_jessica", days: [0, 1, 2, 3, 4, 5, 6], start: "10:00", end: "22:00" },
    { userId: "user_amanda", days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" },
    { userId: "user_james", days: [4, 5, 6, 0], start: "17:00", end: "03:00" },
    { userId: "user_ashley", days: [5, 6, 0], start: "16:00", end: "24:00" },
    { userId: "user_noah", days: [3, 4, 5, 6, 0], start: "10:00", end: "24:00" },
    { userId: "user_daniel", days: [1, 2, 3, 4, 5, 6], start: "07:00", end: "19:00" },
  ];

  for (const row of avail) {
    for (const day of row.days) {
      await prisma.availabilityWindow.create({
        data: { userId: row.userId, type: "RECURRING", dayOfWeek: day, startTime: row.start, endTime: row.end },
      });
    }
  }

  // ── Shifts (current week) ───────────────────────────────────────────────────
  console.log("  Shifts (current week)…");

  const [MON, TUE, WED, THU, FRI, SAT, SUN] = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(WEEK_START, n)) as [Date, Date, Date, Date, Date, Date, Date];

  // Marina (Pacific)
  const s = {
    marinaMonServer: await createShift({ id: "shift_marina_mon_srv", locationId: marina.id, tz: TZ.PACIFIC, skillId: server.id, day: MON, start: 11, end: 19, createdBy: mgrWest.id }),
    marinaMonBar: await createShift({ id: "shift_marina_mon_bar", locationId: marina.id, tz: TZ.PACIFIC, skillId: bartender.id, day: MON, start: 16, end: 24, createdBy: mgrWest.id }),
    marinaTueSrv: await createShift({ id: "shift_marina_tue_srv", locationId: marina.id, tz: TZ.PACIFIC, skillId: server.id, day: TUE, start: 11, end: 19, createdBy: mgrWest.id }),
    marinaTueCook: await createShift({ id: "shift_marina_tue_cook", locationId: marina.id, tz: TZ.PACIFIC, skillId: lineCook.id, day: TUE, start: 9, end: 17, createdBy: mgrWest.id }),
    marinaWedSrv: await createShift({ id: "shift_marina_wed_srv", locationId: marina.id, tz: TZ.PACIFIC, skillId: server.id, day: WED, start: 11, end: 19, createdBy: mgrWest.id }),
    marinaThuBar: await createShift({ id: "shift_marina_thu_bar", locationId: marina.id, tz: TZ.PACIFIC, skillId: bartender.id, day: THU, start: 17, end: 1, createdBy: mgrWest.id }),
    marinaFriSrv: await createShift({ id: "shift_marina_fri_srv", locationId: marina.id, tz: TZ.PACIFIC, skillId: server.id, day: FRI, start: 17, end: 23, headcount: 2, isPremium: true, createdBy: mgrWest.id }),
    marinaFriBar: await createShift({ id: "shift_marina_fri_bar", locationId: marina.id, tz: TZ.PACIFIC, skillId: bartender.id, day: FRI, start: 19, end: 3, isPremium: true, createdBy: mgrWest.id }),
    marinaSatSrv: await createShift({ id: "shift_marina_sat_srv", locationId: marina.id, tz: TZ.PACIFIC, skillId: server.id, day: SAT, start: 17, end: 23, headcount: 3, isPremium: true, createdBy: mgrWest.id }),
    marinaSatBar: await createShift({ id: "shift_marina_sat_bar", locationId: marina.id, tz: TZ.PACIFIC, skillId: bartender.id, day: SAT, start: 19, end: 3, isPremium: true, createdBy: mgrWest.id }),
    marinaSunSrv: await createShift({ id: "shift_marina_sun_srv", locationId: marina.id, tz: TZ.PACIFIC, skillId: server.id, day: SUN, start: 11, end: 19, createdBy: mgrWest.id }),
    // Scenario 1 — Sunday Night Chaos: 7pm shift with no one assigned
    marinaSunEvening: await createShift({ id: "shift_marina_sun_eve", locationId: marina.id, tz: TZ.PACIFIC, skillId: server.id, day: SUN, start: 19, end: 23, createdBy: mgrWest.id }),

    // Boardwalk (Pacific)
    boardwalkFriSrv: await createShift({ id: "shift_boardwalk_fri_srv", locationId: boardwalk.id, tz: TZ.PACIFIC, skillId: server.id, day: FRI, start: 17, end: 22, isPremium: true, createdBy: mgrWest.id }),
    boardwalkSatSrv: await createShift({ id: "shift_boardwalk_sat_srv", locationId: boardwalk.id, tz: TZ.PACIFIC, skillId: server.id, day: SAT, start: 17, end: 23, headcount: 2, isPremium: true, createdBy: mgrWest.id }),
    boardwalkSatBar: await createShift({ id: "shift_boardwalk_sat_bar", locationId: boardwalk.id, tz: TZ.PACIFIC, skillId: bartender.id, day: SAT, start: 18, end: 2, isPremium: true, createdBy: mgrWest.id }),
    boardwalkSunHost: await createShift({ id: "shift_boardwalk_sun_host", locationId: boardwalk.id, tz: TZ.PACIFIC, skillId: host.id, day: SUN, start: 11, end: 17, createdBy: mgrWest.id }),

    // Heights (Eastern)
    heightsMonSrv: await createShift({ id: "shift_heights_mon_srv", locationId: heights.id, tz: TZ.EASTERN, skillId: server.id, day: MON, start: 11, end: 19, createdBy: mgrEast.id }),
    heightsTueCook: await createShift({ id: "shift_heights_tue_cook", locationId: heights.id, tz: TZ.EASTERN, skillId: lineCook.id, day: TUE, start: 9, end: 17, createdBy: mgrEast.id }),
    heightsWedSrv: await createShift({ id: "shift_heights_wed_srv", locationId: heights.id, tz: TZ.EASTERN, skillId: server.id, day: WED, start: 11, end: 20, createdBy: mgrEast.id }),
    heightsThuBar: await createShift({ id: "shift_heights_thu_bar", locationId: heights.id, tz: TZ.EASTERN, skillId: bartender.id, day: THU, start: 17, end: 1, createdBy: mgrEast.id }),
    heightsFriSrv: await createShift({ id: "shift_heights_fri_srv", locationId: heights.id, tz: TZ.EASTERN, skillId: server.id, day: FRI, start: 17, end: 23, headcount: 2, isPremium: true, createdBy: mgrEast.id }),
    heightsSatBar: await createShift({ id: "shift_heights_sat_bar", locationId: heights.id, tz: TZ.EASTERN, skillId: bartender.id, day: SAT, start: 18, end: 3, isPremium: true, createdBy: mgrEast.id }),
    heightsSatSrv: await createShift({ id: "shift_heights_sat_srv", locationId: heights.id, tz: TZ.EASTERN, skillId: server.id, day: SAT, start: 17, end: 23, headcount: 3, isPremium: true, createdBy: mgrEast.id }),

    // Heights — Ryan's cook shifts (Scenario 2 — Overtime Trap)
    heightsMonCook: await createShift({ id: "shift_heights_mon_cook", locationId: heights.id, tz: TZ.EASTERN, skillId: lineCook.id, day: MON, start: 7, end: 15, createdBy: mgrEast.id }),
    heightsWedCook: await createShift({ id: "shift_heights_wed_cook", locationId: heights.id, tz: TZ.EASTERN, skillId: lineCook.id, day: WED, start: 7, end: 15, createdBy: mgrEast.id }),
    heightsThuCook: await createShift({ id: "shift_heights_thu_cook", locationId: heights.id, tz: TZ.EASTERN, skillId: lineCook.id, day: THU, start: 7, end: 15, createdBy: mgrEast.id }),
    heightsFriCook: await createShift({ id: "shift_heights_fri_cook", locationId: heights.id, tz: TZ.EASTERN, skillId: lineCook.id, day: FRI, start: 7, end: 15, createdBy: mgrEast.id }),
    // Draft shift — assigning Ryan here would push him to 48h
    heightsSatCook: await createShift({ id: "shift_heights_sat_cook", locationId: heights.id, tz: TZ.EASTERN, skillId: lineCook.id, day: SAT, start: 7, end: 15, status: ShiftStatus.DRAFT, createdBy: mgrEast.id }),

    // Garden (Eastern)
    gardenFriBar: await createShift({ id: "shift_garden_fri_bar", locationId: garden.id, tz: TZ.EASTERN, skillId: bartender.id, day: FRI, start: 18, end: 2, isPremium: true, createdBy: mgrEast.id }),
    gardenSatSrv: await createShift({ id: "shift_garden_sat_srv", locationId: garden.id, tz: TZ.EASTERN, skillId: server.id, day: SAT, start: 17, end: 23, headcount: 2, isPremium: true, createdBy: mgrEast.id }),
    gardenSatBar: await createShift({ id: "shift_garden_sat_bar", locationId: garden.id, tz: TZ.EASTERN, skillId: bartender.id, day: SAT, start: 19, end: 3, isPremium: true, createdBy: mgrEast.id }),
    gardenSunSrv: await createShift({ id: "shift_garden_sun_srv", locationId: garden.id, tz: TZ.EASTERN, skillId: server.id, day: SUN, start: 12, end: 20, createdBy: mgrEast.id }),

    // Next-week drafts
    nextMonSrv: await createShift({ id: "shift_next_mon_srv", locationId: marina.id, tz: TZ.PACIFIC, skillId: server.id, day: addDays(MON, 7), start: 11, end: 19, status: ShiftStatus.DRAFT, createdBy: mgrWest.id }),
    nextFriBar: await createShift({ id: "shift_next_fri_bar", locationId: heights.id, tz: TZ.EASTERN, skillId: bartender.id, day: addDays(FRI, 7), start: 18, end: 2, status: ShiftStatus.DRAFT, isPremium: true, createdBy: mgrEast.id }),
  };

  // ── Assignments (current week) ──────────────────────────────────────────────
  console.log("  Assignments…");

  const a = {
    sarahMarinaMon: await assign(s.marinaMonServer.id, "user_sarah", mgrWest.id),
    johnMarinaMon: await assign(s.marinaMonBar.id, "user_john", mgrWest.id),
    mariaMarinaTue: await assign(s.marinaTueSrv.id, "user_maria", mgrWest.id),
    davidMarinaTue: await assign(s.marinaTueCook.id, "user_david", mgrWest.id),
    sarahMarinaWed: await assign(s.marinaWedSrv.id, "user_sarah", mgrWest.id),
    johnMarinaThu: await assign(s.marinaThuBar.id, "user_john", mgrWest.id),
    // Scenario 6 — Regret Swap: Sarah & Maria on same Friday server shift
    sarahMarinaFri: await assign(s.marinaFriSrv.id, "user_sarah", mgrWest.id),
    mariaMariaFri: await assign(s.marinaFriSrv.id, "user_maria", mgrWest.id),
    johnMarinaFriBar: await assign(s.marinaFriBar.id, "user_john", mgrWest.id),
    // Scenario 5 — Fairness: Sarah & Maria get Saturday premium every week
    sarahMarinaSat: await assign(s.marinaSatSrv.id, "user_sarah", mgrWest.id),
    mariaMarinaaSat: await assign(s.marinaSatSrv.id, "user_maria", mgrWest.id),
    chrisMarinaSat: await assign(s.marinaSatSrv.id, "user_chris", mgrWest.id),
    michaelSatBar: await assign(s.marinaSatBar.id, "user_michael", mgrWest.id),
    sarahMarinaSun: await assign(s.marinaSunSrv.id, "user_sarah", mgrWest.id),
    // marinaSunEvening intentionally unassigned (Scenario 1)

    emilyBoardwalkFri: await assign(s.boardwalkFriSrv.id, "user_emily", mgrWest.id),
    emilyBoardwalkSat: await assign(s.boardwalkSatSrv.id, "user_emily", mgrWest.id),
    oliviaBoardwalkSat: await assign(s.boardwalkSatSrv.id, "user_olivia", mgrWest.id),
    michaelBoardwalkBar: await assign(s.boardwalkSatBar.id, "user_michael", mgrWest.id),
    oliviaBoardwalkSun: await assign(s.boardwalkSunHost.id, "user_olivia", mgrWest.id),

    jessicaHeightsMon: await assign(s.heightsMonSrv.id, "user_jessica", mgrEast.id),
    ryanHeightsTue: await assign(s.heightsTueCook.id, "user_ryan", mgrEast.id),
    jessicaHeightsWed: await assign(s.heightsWedSrv.id, "user_jessica", mgrEast.id),
    noahHeightsThu: await assign(s.heightsThuBar.id, "user_noah", mgrEast.id),
    jessicaHeightsFri: await assign(s.heightsFriSrv.id, "user_jessica", mgrEast.id),
    amandaHeightsFri: await assign(s.heightsFriSrv.id, "user_amanda", mgrEast.id),
    jessicaHeightsSat: await assign(s.heightsSatSrv.id, "user_jessica", mgrEast.id),
    amandaHeightsSat: await assign(s.heightsSatSrv.id, "user_amanda", mgrEast.id),
    chrisHeightsSat: await assign(s.heightsSatSrv.id, "user_chris", mgrEast.id),
    noahHeightsSatBar: await assign(s.heightsSatBar.id, "user_noah", mgrEast.id),

    // Scenario 2 — Overtime Trap: Ryan gets Mon+Tue+Wed+Thu+Fri cook = 40h
    ryanHeightsMon: await assign(s.heightsMonCook.id, "user_ryan", mgrEast.id),
    ryanHeightsWed: await assign(s.heightsWedCook.id, "user_ryan", mgrEast.id),
    ryanHeightsThu: await assign(s.heightsThuCook.id, "user_ryan", mgrEast.id),
    ryanHeightsFri: await assign(s.heightsFriCook.id, "user_ryan", mgrEast.id),
    // heightsSatCook is DRAFT — adding Ryan = 48h overtime trap

    jamesGardenFri: await assign(s.gardenFriBar.id, "user_james", mgrEast.id),
    ashleyGardenSat: await assign(s.gardenSatSrv.id, "user_ashley", mgrEast.id),
    amandaGardenSat: await assign(s.gardenSatSrv.id, "user_amanda", mgrEast.id),
    jamesGardenSatBar: await assign(s.gardenSatBar.id, "user_james", mgrEast.id),
    jessicaGardenSun: await assign(s.gardenSunSrv.id, "user_jessica", mgrEast.id),
  };

  // ── Swap Request (Scenario 6 — Regret Swap) ─────────────────────────────────
  console.log("  Swap requests…");
  const swapReq = await prisma.swapRequest.upsert({
    where: { id: "swap_sarah_maria_fri" },
    update: {},
    create: {
      id: "swap_sarah_maria_fri",
      type: SwapType.SWAP,
      assignmentId: a.sarahMarinaFri.id,
      initiatorId: "user_sarah",
      receiverId: "user_maria",
      shiftId: s.marinaFriSrv.id,
      status: SwapStatus.PENDING_MANAGER,
    },
  });

  // Mark Sarah's assignment as pending swap
  await prisma.shiftAssignment.update({
    where: { id: a.sarahMarinaFri.id },
    data: { status: "PENDING_SWAP" },
  });

  // ── Shift Pickup Requests ────────────────────────────────────────────────────
  // Pre-seed two pickup requests so managers immediately see the approval queue.
  // Scenario 1: Emily wants to pick up the unassigned Sunday evening shift.
  // Scenario extra: Michael wants the open Saturday server slot at The Marina.
  console.log("  Shift pickup requests…");
  await prisma.shiftPickupRequest.upsert({
    where: { shiftId_userId: { shiftId: s.marinaSunEvening.id, userId: "user_emily" } },
    update: {},
    create: { id: "pickup_emily_sun_eve", shiftId: s.marinaSunEvening.id, userId: "user_emily", status: "PENDING" },
  });
  // marinaSatSrv has headcount:3, 3 assigned — add another open slot by increasing headcount so pickup is visible
  // Instead, use the boardwalk Saturday server shift (headcount 2, 2 assigned) — let's use gardenSunSrv (unassigned)
  await prisma.shiftPickupRequest.upsert({
    where: { shiftId_userId: { shiftId: s.gardenSunSrv.id, userId: "user_ashley" } },
    update: {},
    create: { id: "pickup_ashley_garden_sun", shiftId: s.gardenSunSrv.id, userId: "user_ashley", status: "PENDING" },
  });

  // ── Historical shifts (4 weeks) for Fairness analytics ─────────────────────
  console.log("  Historical shifts (fairness data)…");
  for (let w = 1; w <= 4; w++) {
    const pastMon = subDays(WEEK_START, w * 7);
    const pastFri = addDays(pastMon, 4);
    const pastSat = addDays(pastMon, 5);

    const hFri = await prisma.shift.create({
      data: {
        locationId: marina.id, skillId: server.id,
        startTime: toUtc(pastFri, 17, 0, TZ.PACIFIC),
        endTime: toUtc(pastFri, 23, 0, TZ.PACIFIC),
        headcount: 2, status: ShiftStatus.PUBLISHED,
        publishedAt: pastFri, isPremium: true, createdBy: mgrWest.id,
      },
    });
    const hSat = await prisma.shift.create({
      data: {
        locationId: marina.id, skillId: server.id,
        startTime: toUtc(pastSat, 17, 0, TZ.PACIFIC),
        endTime: toUtc(pastSat, 23, 0, TZ.PACIFIC),
        headcount: 3, status: ShiftStatus.PUBLISHED,
        publishedAt: pastSat, isPremium: true, createdBy: mgrWest.id,
      },
    });

    // Sarah always gets Fri + Sat premium — Chris/Maria share sparingly
    await prisma.shiftAssignment.create({ data: { shiftId: hFri.id, userId: "user_sarah", assignedBy: mgrWest.id } });
    await prisma.shiftAssignment.create({ data: { shiftId: hSat.id, userId: "user_sarah", assignedBy: mgrWest.id } });
    if (w % 2 === 0) {
      await prisma.shiftAssignment.create({ data: { shiftId: hFri.id, userId: "user_maria", assignedBy: mgrWest.id } });
    }
    await prisma.shiftAssignment.create({ data: { shiftId: hSat.id, userId: "user_chris", assignedBy: mgrWest.id } });

    // Midweek filler shifts
    const hWed = await prisma.shift.create({
      data: {
        locationId: marina.id, skillId: server.id,
        startTime: toUtc(addDays(pastMon, 2), 11, 0, TZ.PACIFIC),
        endTime: toUtc(addDays(pastMon, 2), 19, 0, TZ.PACIFIC),
        headcount: 2, status: ShiftStatus.PUBLISHED,
        publishedAt: addDays(pastMon, 2), isPremium: false, createdBy: mgrWest.id,
      },
    });
    await prisma.shiftAssignment.create({ data: { shiftId: hWed.id, userId: "user_chris", assignedBy: mgrWest.id } });
    await prisma.shiftAssignment.create({ data: { shiftId: hWed.id, userId: "user_maria", assignedBy: mgrWest.id } });
  }

  // ── Audit log ───────────────────────────────────────────────────────────────
  console.log("  Audit logs…");
  await prisma.auditLog.createMany({
    skipDuplicates: true,
    data: [
      { entityType: "Shift", entityId: s.marinaFriSrv.id, action: "published", before: { status: "DRAFT" }, after: { status: "PUBLISHED" }, performedBy: mgrWest.id, shiftId: s.marinaFriSrv.id, locationId: marina.id },
      { entityType: "ShiftAssignment", entityId: a.sarahMarinaFri.id, action: "assigned", before: Prisma.JsonNull, after: { userId: "user_sarah" }, performedBy: mgrWest.id, shiftId: s.marinaFriSrv.id, locationId: marina.id },
      { entityType: "SwapRequest", entityId: swapReq.id, action: "created", before: Prisma.JsonNull, after: { status: "PENDING_ACCEPTANCE" }, performedBy: "user_sarah", shiftId: s.marinaFriSrv.id, locationId: marina.id },
      { entityType: "SwapRequest", entityId: swapReq.id, action: "accepted", before: { status: "PENDING_ACCEPTANCE" }, after: { status: "PENDING_MANAGER" }, performedBy: "user_maria", shiftId: s.marinaFriSrv.id, locationId: marina.id },
    ],
  });

  // ── Notifications ───────────────────────────────────────────────────────────
  console.log("  Notifications…");
  await prisma.notification.createMany({
    skipDuplicates: true,
    data: [
      { userId: mgrWest.id, type: "SWAP_REQUESTED", title: "Swap pending approval", message: "Sarah Chen & Maria Rodriguez want to swap the Friday server shift at The Marina.", data: { swapRequestId: swapReq.id, shiftId: s.marinaFriSrv.id }, read: false },
      { userId: "user_sarah", type: "SHIFT_PUBLISHED", title: "Your schedule is live", message: "Tom Garcia published the schedule for The Marina. You have shifts Mon–Sat this week.", read: true, readAt: new Date() },
      { userId: "user_ryan", type: "OVERTIME_WARNING", title: "Approaching 40 hours", message: "You are scheduled for 40 hours this week. Any additional shifts will count as overtime.", read: false },
      { userId: mgrEast.id, type: "OVERTIME_WARNING", title: "Overtime alert: Ryan Wilson", message: "Ryan Wilson is at 40 projected hours. The Saturday cook shift (DRAFT) would bring him to 48 hours.", data: { userId: "user_ryan", projectedHours: 40 }, read: false },
    ],
  });

  console.log("\n✅  Seed complete!\n");
  console.log("┌────────────────────────────────────────────────────────────┐");
  console.log("│  Role     │ Email                           │ Password     │");
  console.log("├────────────────────────────────────────────────────────────┤");
  console.log("│  Admin    │ admin@coastaleats.com           │ Admin123!    │");
  console.log("│  Manager  │ tom.garcia@coastaleats.com      │ Manager123!  │");
  console.log("│  Manager  │ lisa.chen@coastaleats.com       │ Manager123!  │");
  console.log("│  Staff    │ sarah.chen@coastaleats.com      │ Staff123!    │");
  console.log("│  Staff    │ ryan.wilson@coastaleats.com     │ Staff123!    │");
  console.log("│  Staff    │ chris.lee@coastaleats.com       │ Staff123!    │");
  console.log("└────────────────────────────────────────────────────────────┘");
}

main()
  .catch((e) => { console.error("❌  Seed failed:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
