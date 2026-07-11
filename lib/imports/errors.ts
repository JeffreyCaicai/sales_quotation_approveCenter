export interface ImportValidationError {
  sheet: string;
  rowNumber: number;
  column: string;
  key: `import.error.${string}` | "file.formula_not_allowed";
  params: Record<string, string | number>;
}

export function sortImportValidationErrors(
  errors: ImportValidationError[],
): ImportValidationError[] {
  return errors.sort((left, right) =>
    compareText(left.sheet, right.sheet)
    || left.rowNumber - right.rowNumber
    || compareText(left.column, right.column)
    || compareText(left.key, right.key));
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
