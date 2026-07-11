import { toAttendanceDateOnly } from "../attendanceDate";

describe("toAttendanceDateOnly", () => {
  it("produces a UTC-midnight Date for the given Date's local calendar day", () => {
    const input = new Date(2024, 2, 15, 23, 45, 30); // March 15, 2024, 11:45:30 PM local
    const result = toAttendanceDateOnly(input);

    expect(result.getUTCFullYear()).toBe(2024);
    expect(result.getUTCMonth()).toBe(2); // March (0-indexed)
    expect(result.getUTCDate()).toBe(15);
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });

  it("matches the UTC-midnight Date produced by parsing an equivalent 'YYYY-MM-DD' string (manual attendance's date derivation)", () => {
    // This is the core regression guard: manual attendance marking
    // does `new Date("2024-03-15")`, which the ECMA-262 spec always
    // parses as UTC midnight. Card-tap attendance must resolve to the
    // exact same instant for a tap that happens on the same calendar
    // day, or the two attendance-recording paths silently disagree
    // about what day it is.
    const manualDate = new Date("2024-03-15");
    const tapTime = new Date(2024, 2, 15, 8, 30, 0); // a tap at 8:30 AM local on the same day
    const cardTapDate = toAttendanceDateOnly(tapTime);

    expect(cardTapDate.getTime()).toBe(manualDate.getTime());
  });

  it("uses the LOCAL calendar day of the input, not the UTC calendar day", () => {
    // A timestamp very late in the local day should still normalize to
    // that same local day's UTC midnight, not silently roll over to
    // the next UTC day.
    const lateNight = new Date(2024, 5, 30, 23, 59, 59); // June 30, 2024, 11:59:59 PM local
    const result = toAttendanceDateOnly(lateNight);

    expect(result.getUTCFullYear()).toBe(2024);
    expect(result.getUTCMonth()).toBe(5); // June
    expect(result.getUTCDate()).toBe(30);
  });

  it("is idempotent - normalizing an already-normalized date returns the same instant", () => {
    const once = toAttendanceDateOnly(new Date(2024, 0, 1, 14, 0, 0));
    const twice = toAttendanceDateOnly(once);
    expect(twice.getTime()).toBe(once.getTime());
  });
});
