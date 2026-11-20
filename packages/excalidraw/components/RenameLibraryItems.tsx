import { useEffect, useRef, useState } from "react";

import { THEME } from "@excalidraw/common";

import { t } from "../i18n";
import { exportScene } from "../scene/export";

import { Dialog } from "./Dialog";
import DialogActionButton from "./DialogActionButton";
import { IconButton } from "./IconButton";
import { CloseIcon } from "./icons";

import "./PublishLibrary.scss";

import type { LibraryItem, LibraryItems, UIAppState } from "../types";

const SingleLibraryItem = ({
  libItem,
  appState,
  onChange,
  onRemove,
}: {
  libItem: LibraryItem;
  appState: UIAppState;
  onChange: (name: string) => void;
  onRemove: (id: string) => void;
}) => {
  const svgRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const node = svgRef.current;
    if (!node) {
      return;
    }
    (async () => {
      const svg = await exportScene({
        type: "svg",
        data: {
          elements: libItem.elements,
          files: null,
        },
        config: {
          skipInliningFonts: true,
          canvasBackgroundColor: "#fff",
          theme: appState.exportWithDarkMode ? THEME.DARK : THEME.LIGHT,
        },
      });
      node.innerHTML = svg.outerHTML;
    })();
  }, [libItem.elements, appState]);

  return (
    <div className="single-library-item">
      {libItem.status === "published" && (
        <span className="single-library-item-status">
          {t("labels.statusPublished")}
        </span>
      )}
      <div ref={svgRef} className="single-library-item__svg" />
      <IconButton
        aria-label={t("buttons.remove")}
        type="button"
        icon={CloseIcon}
        className="single-library-item--remove"
        onClick={onRemove.bind(null, libItem.id)}
        title={t("buttons.remove")}
      />
      <div
        style={{
          display: "flex",
          margin: "0.8rem 0",
          width: "100%",
          fontSize: "14px",
          fontWeight: 500,
          flexDirection: "column",
        }}
      >
        <label
          style={{
            display: "flex",
            justifyContent: "space-between",
            flexDirection: "column",
          }}
        >
          <div style={{ padding: "0.5em 0" }}>
            <span style={{ fontWeight: 500, color: "#868e96" }}>
              {t("publishDialog.itemName")}
            </span>
            <span aria-hidden="true" className="required">
              *
            </span>
          </div>
          <input
            type="text"
            ref={inputRef}
            style={{ width: "80%", padding: "0.2rem" }}
            value={libItem.name ?? ""}
            placeholder="Item name"
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        </label>
      </div>
    </div>
  );
};

const RenameLibraryItems = ({
  libraryItems,
  appState,
  onClose,
  onSave,
  onRemove,
}: {
  libraryItems: LibraryItems;
  appState: UIAppState;
  onClose: () => void;
  onSave: (items: LibraryItems) => void;
  onRemove: (id: string) => void;
}) => {
  const [names, setNames] = useState(() => new Map<string, string>());
  return (
    <Dialog
      onCloseRequest={onClose}
      title={t("buttons.renameLibItems")}
      className="publish-library"
    >
      <div className="selected-library-items">
        {libraryItems.map((item) => (
          <SingleLibraryItem
            key={item.id}
            libItem={{ ...item, name: names.get(item.id) ?? item.name }}
            appState={appState}
            onChange={(name) =>
              setNames((current) => new Map(current).set(item.id, name))
            }
            onRemove={onRemove}
          />
        ))}
      </div>
      <div className="publish-library__buttons">
        <DialogActionButton
          label={t("buttons.saveLibNames")}
          onClick={() =>
            onSave(
              libraryItems.map((item) =>
                names.get(item.id) === undefined
                  ? item
                  : { ...item, name: names.get(item.id) },
              ),
            )
          }
        />
      </div>
    </Dialog>
  );
};

export default RenameLibraryItems;
