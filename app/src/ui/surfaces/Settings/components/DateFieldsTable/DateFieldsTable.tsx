import Select from '@atlaskit/select';
import type { DateFieldDefaults, DateFieldOption } from '@domain/index.js';

type SelectOption = { label: string; value: string };

export interface DateFieldsTableProps {
  /** hierarchy levels (issue-type names), top → leaf */
  levels: string[];
  /** every pickable date/datetime field on the site */
  fields: DateFieldOption[];
  /** each level's current start/due field ids */
  value: Record<string, DateFieldDefaults>;
  onChange(level: string, next: DateFieldDefaults): void;
}

const COLUMNS = [
  { endpoint: 'start', label: 'Start' },
  { endpoint: 'due', label: 'End' },
] as const;

/**
 * Which Jira date fields each hierarchy level's own start / end dates are read
 * from — one row per level (e.g. Initiative → Target start / Target end).
 */
export function DateFieldsTable({ levels, fields, value, onChange }: DateFieldsTableProps) {
  const options: SelectOption[] = fields.map((f) => ({ label: f.name, value: f.id }));
  // A stored field that no longer exists on the site still shows (by id) so it can be changed.
  const optionFor = (id: string): SelectOption =>
    options.find((o) => o.value === id) ?? { label: `${id} (not found)`, value: id };

  return (
    <table className="w-full table-fixed text-sm">
      <thead>
        <tr className="text-left text-xs font-semibold text-text-subtle">
          <th className="w-1/4 pb-2 font-semibold">Level</th>
          {COLUMNS.map((c) => (
            <th key={c.endpoint} className="pb-2 pl-3 font-semibold">
              {c.label} date field
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {levels.map((level) => {
          const current = value[level];
          if (!current) return null;
          return (
            <tr key={level}>
              <td className="py-1 pr-3 font-medium">{level}</td>
              {COLUMNS.map((c) => (
                <td key={c.endpoint} className="py-1 pl-3">
                  <Select<SelectOption>
                    aria-label={`${level} ${c.label.toLowerCase()} date field`}
                    spacing="compact"
                    options={options}
                    value={optionFor(current[c.endpoint])}
                    onChange={(o) => o && onChange(level, { ...current, [c.endpoint]: o.value })}
                  />
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
