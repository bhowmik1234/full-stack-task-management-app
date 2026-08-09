import { ReactNode, useMemo, useState } from "react";
import { FiChevronDown, FiChevronLeft, FiChevronRight, FiChevronUp, FiSearch } from "react-icons/fi";

/**
 * One column. `value` is what the column sorts and searches on; `render` is
 * what it draws. Keeping those separate is the whole point: the old admin
 * tables stored a `<Link>` element in the data and so could only sort rows by
 * the identity of a React element, which is why none of them sorted usefully.
 */
export type Column<T> = {
  key: string;
  header: string;
  /** Sortable/searchable scalar. Omit to make the column neither. */
  value?: (row: T) => string | number;
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
  width?: string;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Placeholder for the filter box. Omit to hide it. */
  search?: string;
  pageSize?: number;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
};

function DataTable<T>({
  columns,
  rows,
  rowKey,
  search,
  pageSize = 12,
  empty = "Nothing here yet.",
  onRowClick,
}: Props<T>) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const [page, setPage] = useState(0);

  const searchable = useMemo(
    () => columns.filter((c) => c.value),
    [columns]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      searchable.some((c) => String(c.value!(row)).toLowerCase().includes(q))
    );
  }, [rows, query, searchable]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.value) return filtered;

    // Copy first: sorting `filtered` in place would mutate the query cache's
    // array when no filter is active.
    return [...filtered].sort((a, b) => {
      const left = column.value!(a);
      const right = column.value!(b);
      const order =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right), undefined, { numeric: true });
      return sort.desc ? -order : order;
    });
  }, [filtered, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  // Filtering can strand the viewer past the end of the list.
  const current = Math.min(page, pageCount - 1);
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize);

  const toggleSort = (key: string) =>
    setSort((prev) =>
      prev?.key === key ? (prev.desc ? null : { key, desc: true }) : { key, desc: false }
    );

  return (
    <div className="c-table">
      {search && (
        <label className="c-table__search">
          <FiSearch aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder={search}
            aria-label={search}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
      )}

      <div className="c-table__scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column) => {
                const active = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    style={{ width: column.width, textAlign: column.align ?? "left" }}
                    aria-sort={active ? (sort!.desc ? "descending" : "ascending") : "none"}
                  >
                    {column.value ? (
                      <button type="button" onClick={() => toggleSort(column.key)}>
                        {column.header}
                        {active &&
                          (sort!.desc ? (
                            <FiChevronDown aria-hidden="true" />
                          ) : (
                            <FiChevronUp aria-hidden="true" />
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
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? "is-clickable" : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key} style={{ textAlign: column.align ?? "left" }}>
                    {column.render ? column.render(row) : column.value?.(row)}
                  </td>
                ))}
              </tr>
            ))}

            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="c-table__empty">
                  {query ? `No matches for “${query}”.` : empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {sorted.length > pageSize && (
        <div className="c-table__foot">
          <span>
            {current * pageSize + 1}–{Math.min((current + 1) * pageSize, sorted.length)} of{" "}
            {sorted.length}
          </span>
          <div>
            <button
              type="button"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
              aria-label="Previous page"
            >
              <FiChevronLeft />
            </button>
            <button
              type="button"
              disabled={current >= pageCount - 1}
              onClick={() => setPage(current + 1)}
              aria-label="Next page"
            >
              <FiChevronRight />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataTable;
