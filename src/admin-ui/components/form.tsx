export function TextInput(
  props: Readonly<{
    name: string;
    label: string;
    type?: string;
    value?: string;
    required?: boolean;
    autofocus?: boolean;
  }>
): string {
  return (
    <>
      <label for={props.name}>{props.label}</label>
      <input
        type={props.type ?? "text"}
        name={props.name}
        id={props.name}
        value={props.value ?? ""}
        required={props.required}
        autofocus={props.autofocus}
      />
    </>
  ) as string;
}

export function Select(
  props: Readonly<{
    name: string;
    label: string;
    options: [string, string][];
    value?: string;
  }>
): string {
  return (
    <>
      <label for={props.name}>{props.label}</label>
      <select name={props.name} id={props.name}>
        {props.options.map(([v, l]) => (
          <option value={v} selected={props.value === v}>
            {l}
          </option>
        ))}
      </select>
    </>
  ) as string;
}
