import { generateOneTimePassword } from "../password";

describe("password - generateOneTimePassword", () => {
  it("generates a password satisfying changePasswordSchema's strength rule (8+ chars, uppercase, digit)", () => {
    const password = generateOneTimePassword();
    expect(password.length).toBeGreaterThanOrEqual(8);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[0-9]/);
  });

  it("never contains visually-ambiguous characters (0, O, 1, l, I)", () => {
    // The trailing "A9" suffix is fixed and known-safe; only check the
    // randomly-drawn prefix for ambiguous characters.
    const password = generateOneTimePassword();
    const randomPart = password.slice(0, -2);
    expect(randomPart).not.toMatch(/[0O1lI]/);
  });

  it("generates a different password on each call", () => {
    const passwords = new Set(Array.from({ length: 20 }, () => generateOneTimePassword()));
    expect(passwords.size).toBe(20);
  });
});
