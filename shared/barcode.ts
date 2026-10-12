/**
 * EAN-13 barcode generation and verification utilities.
 *
 * GS1 reserves the '20' to '29' prefixes for internal in-store product barcodes
 * (restricted circulation). Using '20' prevents collisions with international
 * commercial GS1 manufacturer prefixes.
 */

export function calculateEan13CheckDigit(twelveDigits: string): number {
  if (twelveDigits.length !== 12 || !/^\d{12}$/.test(twelveDigits)) {
    throw new Error('Must provide exactly 12 numeric digits to calculate EAN-13 check digit');
  }
  let oddSum = 0;
  let evenSum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(twelveDigits[i]);
    if (i % 2 === 0) {
      oddSum += d;
    } else {
      evenSum += d;
    }
  }
  const total = oddSum + evenSum * 3;
  return (10 - (total % 10)) % 10;
}

/**
 * Generates an in-store 13-digit EAN-13 barcode candidate:
 * '20' prefix + 6 timestamp digits + 4 random digits + 1 checksum digit.
 */
export function generateEan13Candidate(): string {
  const timePart = String(Date.now()).slice(-6);
  const randPart = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  const first12 = `20${timePart}${randPart}`;
  const check = calculateEan13CheckDigit(first12);
  return `${first12}${check}`;
}

/** Validates whether a string is a structurally sound 13-digit EAN-13 barcode. */
export function isValidEan13(code: string): boolean {
  if (!code || code.length !== 13 || !/^\d{13}$/.test(code)) return false;
  const first12 = code.slice(0, 12);
  const expectedCheck = calculateEan13CheckDigit(first12);
  return Number(code[12]) === expectedCheck;
}
