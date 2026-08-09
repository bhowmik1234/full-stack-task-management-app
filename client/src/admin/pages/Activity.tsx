import { useActivityQuery } from "../api";
import { formatDateTime } from "../hooks";
import { AuditEntry } from "../types";
import DataTable, { Column } from "../components/DataTable";
import { SkeletonRows } from "../components/Spinner";
import { Card, EmptyState, PageHeader } from "../components/ui";

/**
 * Colour by what the action does, not by which resource it touches: an operator
 * scanning this page is looking for destructive changes.
 */
const tone = (action: string) =>
  action.endsWith(".delete")
    ? "critical"
    : action.endsWith(".create")
    ? "good"
    : "info";

const Activity = () => {
  const { data, isLoading, isError } = useActivityQuery(100);

  const columns: Column<AuditEntry>[] = [
    {
      key: "when",
      header: "When",
      width: "12rem",
      value: (entry) => entry.createdAt,
      render: (entry) => formatDateTime(entry.createdAt),
    },
    {
      key: "who",
      header: "Who",
      value: (entry) => entry.actorName,
    },
    {
      key: "action",
      header: "Action",
      value: (entry) => entry.action,
      render: (entry) => (
        <span className={`c-pill c-pill--${tone(entry.action)}`}>{entry.action}</span>
      ),
    },
    {
      key: "summary",
      header: "What changed",
      value: (entry) => entry.summary,
    },
    {
      key: "ip",
      header: "From",
      width: "9rem",
      value: (entry) => entry.ip ?? "",
      render: (entry) => <span className="c-muted">{entry.ip ?? "—"}</span>,
    },
  ];

  return (
    <div className="l-page">
      <PageHeader
        title="Activity"
        subtitle="Every change made from this console, most recent first."
      />

      <Card>
        {isLoading ? (
          <SkeletonRows rows={8} />
        ) : isError || !data ? (
          <EmptyState>Could not load the activity log.</EmptyState>
        ) : (
          <DataTable
            columns={columns}
            rows={data.entries}
            rowKey={(entry) => entry._id}
            search="Search by admin, action or target"
            empty="Nothing has been changed from the console yet."
          />
        )}
      </Card>

      <p className="c-note">
        The log is append-only and survives the thing it describes — an entry for
        a deleted product still names it. Customer activity is not recorded here;
        this is the trail of what administrators did.
      </p>
    </div>
  );
};

export default Activity;
