const IDR_NUMERIC_18_0 = /^(?:0|[1-9]\d{0,17})$/u;

export function isValidIdrPrice(value: string): boolean {
  return IDR_NUMERIC_18_0.test(value);
}
