export function Nav(props: Readonly<{ current: string }>): string {
  const items = [
    ["/admin", "Dashboard"],
    ["/admin/brands", "Brands"],
    ["/admin/queue", "Review queue"],
    ["/admin/cohort", "Cohort"],
    ["/admin/jobs", "Jobs"],
    ["/admin/assessments", "Assessments"],
    ["/admin/usage", "Usage"],
    ["/admin/settings", "Settings"],
  ] as const;
  return (
    <nav class="container-fluid">
      <ul>
        <li>
          <strong>brand-scan</strong>
        </li>
      </ul>
      <ul>
        {items.map(([href, label]) => (
          <li>
            <a href={href} aria-current={props.current === href ? "page" : undefined}>
              {label}
            </a>
          </li>
        ))}
        <li>
          <form method="post" action="/admin/logout" style="display:inline;">
            <button type="submit" class="secondary outline">
              Log out
            </button>
          </form>
        </li>
      </ul>
    </nav>
  ) as string;
}
