// Model browser: tree of the store with expand/collapse, selection and visibility.
// Follows the ARIA tree pattern (arrow keys, Home/End, Enter/Space). An object has
// a context menu (#138): right click, its ⋯ button, or Shift+F10.
import { useRef, useState } from "preact/hooks";
import type { TreeNode } from "../core/tree";
import { Icon, type IconName } from "./icons";
import { ContextMenu, type MenuItem } from "./Menu";

/** Kinds of objects that can be shown or hidden in the viewport. */
export const VISIBLE_KINDS = new Set([
  "mesh",
  "cellset",
  "section",
  "pointset",
  "rigid",
  "faceset",
  "boundary",
  "constraint",
  "load",
  "pressure",
]);

interface Props {
  nodes: TreeNode[];
  selected?: string;
  hidden: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onToggleVisible: (id: string) => void;
  /** The items of the context menu of an object, if it has one (#138). */
  menuItems?: (id: string) => MenuItem[];
}

interface Row {
  node: TreeNode;
  level: number;
  parent?: string;
}

const domId = (id: string) => `tree-${id.replace(/[^A-Za-z0-9_-]/g, "-")}`;

/** Count the issues of a node and its children. */
function issueCount(node: TreeNode): number {
  return (
    node.issues.length + node.children.reduce((n, c) => n + issueCount(c), 0)
  );
}

export function Browser({
  nodes,
  selected,
  hidden,
  onSelect,
  onToggleVisible,
  menuItems,
}: Props) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState<string | undefined>();
  // the open context menu: of an object, at a place in the window
  const [menu, setMenu] = useState<{
    id: string;
    place: { top: number; left: number };
  }>();
  const moreButton = useRef<HTMLElement | null>(null);

  /**
   * Open the context menu of an object. It is focused, not selected: a selection
   * would close the browser where it is a drawer (narrow windows).
   */
  const openMenu = (id: string, place: { top: number; left: number }) => {
    if (!menuItems) return;
    setFocused(id);
    setMenu({ id, place });
  };

  /** The context menu below a row or a button. */
  const below = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.bottom + 2, left: rect.left };
  };

  // visible rows in order, for rendering and keyboard navigation
  const rows: Row[] = [];
  const walk = (list: TreeNode[], level: number, parent?: string) => {
    for (const node of list) {
      rows.push({ node, level, parent });
      if (node.children.length && !collapsed.has(node.id))
        walk(node.children, level + 1, node.id);
    }
  };
  walk(nodes, 1);

  const focus = rows.some((r) => r.node.id === focused)
    ? focused
    : (selected ?? rows[0]?.node.id);

  const setExpanded = (id: string, expanded: boolean) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (expanded) next.delete(id);
      else next.add(id);
      return next;
    });

  const moveTo = (id: string | undefined) => {
    if (!id) return;
    setFocused(id);
    document.getElementById(domId(id))?.focus();
  };

  const activate = (node: TreeNode) => {
    if (node.kind === "group") setExpanded(node.id, collapsed.has(node.id));
    else onSelect(node.id);
  };

  const onKeyDown = (event: KeyboardEvent, row: Row, index: number) => {
    const { node } = row;
    const expandable = node.children.length > 0;
    const expanded = expandable && !collapsed.has(node.id);
    switch (event.key) {
      case "ArrowDown":
        moveTo(rows[index + 1]?.node.id);
        break;
      case "ArrowUp":
        moveTo(rows[index - 1]?.node.id);
        break;
      case "Home":
        moveTo(rows[0]?.node.id);
        break;
      case "End":
        moveTo(rows[rows.length - 1]?.node.id);
        break;
      case "ArrowRight":
        if (expandable && !expanded) setExpanded(node.id, true);
        else if (expanded) moveTo(node.children[0].id);
        break;
      case "ArrowLeft":
        if (expanded) setExpanded(node.id, false);
        else moveTo(row.parent);
        break;
      case "Enter":
      case " ":
        activate(node);
        break;
      case "ContextMenu":
      case "F10":
        if (event.key === "F10" && !event.shiftKey) return;
        if (node.kind === "group") return;
        openMenu(node.id, below(event.currentTarget as Element));
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const closeMenu = (focus: boolean) => {
    const id = menu?.id;
    setMenu(undefined);
    moreButton.current = null;
    if (focus && id) moveTo(id);
  };

  return (
    <>
      <ul role="tree" aria-label="Model" class="tree">
        {rows.map((row, index) => {
          const { node, level } = row;
          const expandable = node.children.length > 0;
          const expanded = expandable && !collapsed.has(node.id);
          const issues = issueCount(node);
          const isGroup = node.kind === "group";
          const isHidden = hidden.has(node.id);
          return (
            <li
              key={node.id}
              id={domId(node.id)}
              role="treeitem"
              aria-level={level}
              aria-expanded={expandable ? expanded : undefined}
              aria-selected={isGroup ? undefined : node.id === selected}
              aria-label={node.label}
              tabIndex={node.id === focus ? 0 : -1}
              class={[
                "tree-row",
                isGroup ? "group" : "item",
                node.id === selected ? "selected" : "",
                isHidden ? "hidden-object" : "",
              ].join(" ")}
              style={{ paddingLeft: `${4 + (level - 1) * 16}px` }}
              onClick={(event) => {
                event.stopPropagation();
                setFocused(node.id);
                activate(node);
              }}
              onKeyDown={(event) => onKeyDown(event, row, index)}
              onContextMenu={(event) => {
                if (isGroup || !menuItems) return;
                event.preventDefault();
                event.stopPropagation();
                openMenu(node.id, { top: event.clientY, left: event.clientX });
              }}
            >
              <span
                class="tree-chevron"
                aria-hidden="true"
                onClick={(event) => {
                  if (!expandable) return;
                  event.stopPropagation();
                  setExpanded(node.id, !expanded);
                }}
              >
                {expandable && (
                  <Icon
                    name={expanded ? "chevronDown" : "chevronRight"}
                    size={12}
                  />
                )}
              </span>
              {VISIBLE_KINDS.has(node.kind) ? (
                <button
                  type="button"
                  class="tree-eye"
                  tabIndex={-1}
                  aria-label={`${isHidden ? "Show" : "Hide"} ${node.label}`}
                  aria-pressed={!isHidden}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleVisible(node.id);
                  }}
                >
                  <Icon name={isHidden ? "eyeOff" : "eye"} size={14} />
                </button>
              ) : (
                <span class="tree-eye" aria-hidden="true" />
              )}
              {!isGroup && (
                <span class="tree-icon">
                  <Icon name={(node.icon ?? node.kind) as IconName} size={14} />
                </span>
              )}
              <span class="tree-label">{node.label}</span>
              <span class="tree-detail">
                {isGroup ? node.count : node.detail}
              </span>
              {issues > 0 && (
                <span
                  class="tree-issue"
                  title={isGroup ? `${issues} issues` : node.issues.join("\n")}
                  aria-label={`${issues} ${issues === 1 ? "issue" : "issues"}`}
                >
                  <Icon name="warning" size={14} />
                  {isGroup && issues}
                </span>
              )}
              {!isGroup && menuItems && (
                <button
                  type="button"
                  class="tree-more"
                  tabIndex={-1}
                  aria-label={`Actions of ${node.label}`}
                  title="Actions"
                  aria-haspopup="menu"
                  aria-expanded={menu?.id === node.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (menu?.id === node.id) return closeMenu(false);
                    moreButton.current = event.currentTarget;
                    openMenu(node.id, below(event.currentTarget));
                  }}
                >
                  ⋯
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {menu && menuItems && (
        <ContextMenu
          label={menu.id}
          sections={[{ items: menuItems(menu.id) }]}
          place={menu.place}
          anchor={moreButton}
          onClose={closeMenu}
        />
      )}
    </>
  );
}
