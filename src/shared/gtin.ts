/**
 * GTIN (UPC-A / EAN-13 / EAN-8 / GTIN-14) validation, shared by the client
 * scanner and the server's telemetry PII guard.
 *
 * It lives in shared/ deliberately: the server exempts a bare product barcode
 * from the phone-number heuristic, and that exemption is only safe if it uses
 * exactly the same definition of "is a barcode" that the scanner accepts.
 */

/** Lengths the GTIN family defines. Anything else is not a retail barcode. */
const GTIN_SHAPE = /^(\d{8}|\d{12}|\d{13}|\d{14})$/;

/**
 * True when the string is a valid GTIN, check digit included. A single-digit
 * misread fails — which is the whole reason the check digit exists.
 */
export function isGtin(code: string): boolean {
  if (!GTIN_SHAPE.test(code)) return false;
  const digits = Array.from(code, Number);
  const check = digits[digits.length - 1] as number;
  // Weights alternate 3,1,3,1… from the last data digit leftward.
  const sum = digits
    .slice(0, -1)
    .reverse()
    .reduce((acc, digit, i) => acc + digit * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** True when the string has a GTIN's shape, regardless of its check digit. */
export function looksLikeGtin(code: string): boolean {
  return GTIN_SHAPE.test(code);
}
