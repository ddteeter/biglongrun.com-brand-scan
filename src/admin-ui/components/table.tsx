export interface Column<T> {
  header: string;
  render: (row: T) => string;
}

export function DataTable<T>(
  props: Readonly<{ columns: Column<T>[]; rows: T[]; emptyMessage?: string }>
): string {
  if (props.rows.length === 0) {
    return (<p>{props.emptyMessage ?? "No data."}</p>) as string;
  }
  return (
    <figure>
      <table role="grid">
        <thead>
          <tr>
            {props.columns.map((c) => (
              <th>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr>
              {props.columns.map((c) => (
                <td>{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  ) as string;
}
