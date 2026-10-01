"use client";
import { buttonClass } from "@/components/ui/primitives";
import { downloadCsv, toCsv, type CsvColumn } from "../lib/export-csv";

export function ExportCsvButton<T extends Record<string, unknown>>({
  rows,
  columns,
  filename,
  label = "Export CSV",
}: {
  rows: T[];
  columns: CsvColumn<T>[];
  filename: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => downloadCsv(filename, toCsv(rows, columns))}
      disabled={rows.length === 0}
      className={buttonClass("secondary", "sm")}
    >
      <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5m-5 5V3" />
      </svg>
      {label}
    </button>
  );
}