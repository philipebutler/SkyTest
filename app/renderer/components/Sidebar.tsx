import React from "react";
import type { Screen } from "../App";

const NAV_ITEMS: { id: Screen; label: string; icon: string }[] = [
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "tests", label: "Tests", icon: "📋" },
  { id: "runs", label: "Runs", icon: "📊" },
  { id: "record", label: "Record", icon: "⏺" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

interface Props {
  active: Screen;
  onNavigate: (screen: Screen) => void;
}

export default function Sidebar({ active, onNavigate }: Props): React.ReactElement {
  return (
    <nav style={styles.sidebar}>
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          onClick={() => onNavigate(item.id)}
          style={{
            ...styles.navButton,
            ...(active === item.id ? styles.navButtonActive : {}),
          }}
          title={item.label}
        >
          <span style={styles.icon}>{item.icon}</span>
          <span style={styles.label}>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: "140px",
    minWidth: "140px",
    flexShrink: 0,
    backgroundColor: "#252526",
    borderRight: "1px solid #3c3c3c",
    display: "flex",
    flexDirection: "column",
    paddingTop: "0.5rem",
  },
  navButton: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.65rem 1rem",
    background: "none",
    border: "none",
    color: "#cccccc",
    cursor: "pointer",
    fontSize: "0.875rem",
    textAlign: "left",
    width: "100%",
  },
  navButtonActive: {
    backgroundColor: "#37373d",
    color: "#ffffff",
    borderLeft: "2px solid #007acc",
    paddingLeft: "calc(1rem - 2px)",
  },
  icon: {
    fontSize: "1rem",
  },
  label: {
    flex: 1,
  },
};
