import { ReactNode, useMemo, useState } from "react";
import {
  AiOutlineSortAscending,
  AiOutlineSortDescending,
} from "react-icons/ai";

/**
 * Sortable, paginated table for the customer's order list.
 *
 * Was `react-table` v7, which cost 62 kB (18 kB gzipped) to render six rows —
 * more than a fifth of what a shopper downloaded before anything appeared, for
 * one table on one page behind a login. This does the same job in a fraction of
 * that, and removes both the dependency and the module augmentation in
 * `types/react-table-config.d.ts` that v7's plugin typings needed.
 *
 * It is a near-twin of `src/admin/components/DataTable.tsx` and deliberately not
 * an import of it: the two apps share types and utils and nothing else, and the
 * console's table is styled with its own `c-` classes from admin.scss, which the
 * storefront never loads. Sharing it would mean either shipping console CSS to
 * shoppers or parameterising every class name.
 *
 * `value` sorts, `render` draws. The split matters — the previous columns kept
 * a `<Link>` element in the data itself, so "sort by status" compared React
 * elements and did nothing useful.
 */
export type Column<T> = {
  key: string;
  header: string;
  /** Sortable scalar. Omit to make the column unsortable. */
  value?: (row: T) => string | number;
  render?: (row: T) => ReactNode;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  pageSize?: number;
  className?: string;
};

function DataTable<T>({
  columns,
  rows,
  rowKey,
  pageSize = 6,
  className = "",
}: Props<T>) {
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.value) return rows;

    // Copied first: sorting `rows` in place would mutate the RTK Query cache's
    // own array, which is frozen in development and shared in production.
    return [...rows].sort((a, b) => {
      const left = column.value!(a);
      const right = column.value!(b);
      const order =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right), undefined, { numeric: true });
      return sort.desc ? -order : order;
    });
  }, [rows, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  // A shorter list can strand the viewer past the end of it.
  const current = Math.min(page, pageCount - 1);
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize);

  // Ascending, then descending, then back to the order the server sent — which
  // for orders is newest first and is the one most people actually want.
  const toggleSort = (key: string) =>
    setSort((prev) =>
      prev?.key === key ? (prev.desc ? null : { key, desc: true }) : { key, desc: false }
    );

  return (
    <div className={className}>
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              return (
                <th
                  key={column.key}
                  aria-sort={
                    active ? (sort!.desc ? "descending" : "ascending") : "none"
                  }
                >
                  {column.value ? (
                    <button type="button" onClick={() => toggleSort(column.key)}>
                      {column.header}
                      {active &&
                        (sort!.desc ? (
                          <AiOutlineSortDescending />
                        ) : (
                          <AiOutlineSortAscending />
                        ))}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.key}>
                  {column.render ? column.render(row) : column.value?.(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {sorted.length > pageSize && (
        <div className="table-pagination">
          <button disabled={current === 0} onClick={() => setPage(current - 1)}>
            Prev
          </button>
          <span>{`${current + 1} of ${pageCount}`}</span>
          <button
            disabled={current >= pageCount - 1}
            onClick={() => setPage(current + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

export default DataTable;
