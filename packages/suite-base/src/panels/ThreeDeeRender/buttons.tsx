// SPDX-License-Identifier: MPL-2.0

import {
  ArrowDownload20Regular,
  ArrowRouting20Regular,
  Cursor20Regular,
  PointScan20Filled,
  PointScan20Regular,
  ZoomFit20Regular,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";
import PublishPointIcon from "@lichtblick/suite-base/components/PublishPointIcon";

import PerspectiveButtonLabel from "./PerspectiveButtonLabel";

const measureIconStyle = {
  transform: "rotate(45deg)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
} as const;

/** The measure tool's icon, filled while measuring. */
export function MeasureIcon(props: { filled?: boolean }): React.JSX.Element {
  return (
    <div style={measureIconStyle}>
      {props.filled === true ? <PointScan20Filled /> : <PointScan20Regular />}
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

const inspect = { id: "threeDeeInspect", icon: Cursor20Regular, placement: "overlay" } as const;

export const THREE_DEE_BUTTONS = {
  inspect,
  perspective: { id: "threeDeePerspective", icon: PerspectiveButtonLabel, placement: "overlay" },
  zoomToData: { id: "threeDeeZoomToData", icon: ZoomFit20Regular, placement: "overlay" },
  measure: { id: "threeDeeMeasure", icon: MeasureIcon, placement: "overlay" },
  measureFrames: {
    id: "threeDeeMeasureFrames",
    icon: ArrowRouting20Regular,
    placement: "overlay",
  },
  publish: { id: "threeDeePublish", icon: PublishIcon, placement: "overlay" },
} as const satisfies Record<string, PanelButton>;

export const IMAGE_BUTTONS = {
  inspect,
  download: { id: "imageDownload", icon: ArrowDownload20Regular, placement: "overlay" },
  resetView: { id: "imageResetView", icon: ResetViewLabel, placement: "overlay" },
} as const satisfies Record<string, PanelButton>;
