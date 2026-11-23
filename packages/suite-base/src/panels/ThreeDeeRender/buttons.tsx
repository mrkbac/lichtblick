// SPDX-License-Identifier: MPL-2.0

import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import CenterFocusWeakIcon from "@mui/icons-material/CenterFocusWeak";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import NearMeOutlinedIcon from "@mui/icons-material/NearMeOutlined";
import RouteOutlinedIcon from "@mui/icons-material/RouteOutlined";
import { useTranslation } from "react-i18next";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";
import PublishPointIcon from "@lichtblick/suite-base/components/PublishPointIcon";

import PerspectiveButtonLabel from "./PerspectiveButtonLabel";

const measureIconStyle = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
} as const;

/** The measure tool's icon, filled while measuring. */
export function MeasureIcon(props: {
  filled?: boolean;
  fontSize?: "small" | "inherit";
}): React.JSX.Element {
  return (
    <div style={measureIconStyle}>
      {props.filled === true ? (
        <CenterFocusStrongIcon fontSize="small" />
      ) : (
        <CenterFocusWeakIcon fontSize="small" />
      )}
    </div>
  );
}

function PublishIcon(): React.JSX.Element {
  return <PublishPointIcon fontSize="small" />;
}

/** The text the reset view button shows in place of an icon. */
function ResetViewLabel(): React.JSX.Element {
  const { t } = useTranslation("panelButtons");
  return <>{t("imageResetView.title")}</>;
}

const inspect = { id: "threeDeeInspect", icon: NearMeOutlinedIcon, placement: "overlay" } as const;

export const THREE_DEE_BUTTONS = {
  inspect,
  perspective: { id: "threeDeePerspective", icon: PerspectiveButtonLabel, placement: "overlay" },
  zoomToData: { id: "threeDeeZoomToData", icon: FitScreenIcon, placement: "overlay" },
  measure: { id: "threeDeeMeasure", icon: MeasureIcon, placement: "overlay" },
  measureFrames: {
    id: "threeDeeMeasureFrames",
    icon: RouteOutlinedIcon,
    placement: "overlay",
  },
  publish: { id: "threeDeePublish", icon: PublishIcon, placement: "overlay" },
} as const satisfies Record<string, PanelButton>;

export const IMAGE_BUTTONS = {
  inspect,
  download: { id: "imageDownload", icon: FileDownloadOutlinedIcon, placement: "overlay" },
  resetView: { id: "imageResetView", icon: ResetViewLabel, placement: "overlay" },
} as const satisfies Record<string, PanelButton>;
