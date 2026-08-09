import type { Permission } from "../permissions";
import type { AccessPreset, PermissionMeta } from "../types";

/**
 * The permission editor, shared by the grant form and the edit panel.
 *
 * The catalog and the presets both come from the API rather than being written
 * here, so a permission added on the server appears with its own description
 * instead of as a bare enum value nobody can interpret.
 *
 * A preset only fills the boxes. What gets stored is the resulting list, so
 * changing a preset later cannot silently change what an existing operator is
 * allowed to do — the failure mode of storing a role name and resolving it at
 * request time.
 */
const PermissionPicker = ({
  catalog,
  grantable,
  presets,
  value,
  onChange,
}: {
  catalog: PermissionMeta[];
  grantable: Permission[];
  presets: AccessPreset[];
  value: Permission[];
  onChange: (next: Permission[]) => void;
}) => {
  // access_manage is in the catalog so it can be *described*, but it is never
  // in `grantable` — the server refuses it, and offering a checkbox the API
  // rejects would be a lie in the interface.
  const options = catalog.filter((meta) => grantable.includes(meta.permission));

  const groups = [...new Set(options.map((meta) => meta.group))];

  const toggle = (permission: Permission) =>
    onChange(
      value.includes(permission)
        ? value.filter((p) => p !== permission)
        : [...value, permission]
    );

  return (
    <div className="c-perms">
      <div className="c-perms__presets">
        <span className="c-perms__presetlabel">Start from</span>
        {presets.map((preset) => (
          <button
            key={preset.name}
            type="button"
            className="c-btn c-btn--tiny"
            title={preset.description}
            onClick={() => onChange(preset.permissions)}
          >
            {preset.label}
          </button>
        ))}
        <button type="button" className="c-btn c-btn--tiny" onClick={() => onChange([])}>
          Clear
        </button>
      </div>

      {groups.map((group) => (
        <fieldset key={group} className="c-perms__group">
          <legend>{group}</legend>
          {options
            .filter((meta) => meta.group === group)
            .map((meta) => (
              <label key={meta.permission} className="c-perms__item">
                <input
                  type="checkbox"
                  checked={value.includes(meta.permission)}
                  onChange={() => toggle(meta.permission)}
                />
                <span>
                  <strong>{meta.label}</strong>
                  {/* What the holder can actually do, in words. A list of enum
                      names is not something anyone can grant responsibly. */}
                  <small>{meta.description}</small>
                </span>
              </label>
            ))}
        </fieldset>
      ))}
    </div>
  );
};

export default PermissionPicker;
