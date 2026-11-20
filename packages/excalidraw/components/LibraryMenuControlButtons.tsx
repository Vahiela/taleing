import clsx from "clsx";

import LibraryMenuBrowseButton from "./LibraryMenuBrowseButton";

import type { ExcalidrawProps, UIAppState } from "../types";

export const LibraryMenuControlButtons = ({
  libraryReturnUrl,
  theme,
  id,
  style,
  children,
  className,
}: {
  libraryReturnUrl: ExcalidrawProps["libraryReturnUrl"];
  theme: UIAppState["theme"];
  id: string;
  style: React.CSSProperties;
  children?: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={clsx("library-menu-control-buttons", className)}
      style={style}
    >
      {import.meta.env.VITE_APP_LIBRARY_URL && (
        <LibraryMenuBrowseButton
          id={id}
          libraryReturnUrl={libraryReturnUrl}
          theme={theme}
        />
      )}
      {children}
    </div>
  );
};
