// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import {
  Button,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  Typography,
} from "@mui/material";
import {
  RowSelectionState,
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  flexRender,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useSnackbar } from "notistack";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { Immutable } from "@lichtblick/suite";
import { InstallButton } from "@lichtblick/suite-base/components/ExtensionsSettings/components/ExtensionActionButton/InstallButton";
import { UninstallButton } from "@lichtblick/suite-base/components/ExtensionsSettings/components/ExtensionActionButton/UninstallButton";
import {
  ExtensionListProps,
  initialPagination,
} from "@lichtblick/suite-base/components/ExtensionsSettings/components/ExtensionList/types";
import {
  displayNameForNamespace,
  generatePlaceholderList,
} from "@lichtblick/suite-base/components/ExtensionsSettings/components/ExtensionList/utils";
import { useExtensionOperations } from "@lichtblick/suite-base/components/ExtensionsSettings/hooks/useExtensionOperations";
import {
  ExtensionActionsLabel,
  ExtensionOperationStatusLabel,
} from "@lichtblick/suite-base/components/ExtensionsSettings/types";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useAnalytics } from "@lichtblick/suite-base/context/AnalyticsContext";
import { useExtensionCatalog } from "@lichtblick/suite-base/context/ExtensionCatalogContext";
import { ExtensionMarketplaceDetail } from "@lichtblick/suite-base/context/ExtensionMarketplaceContext";
import { AppEvent } from "@lichtblick/suite-base/services/IAnalytics";
import { canInstallExtension } from "@lichtblick/suite-base/util/canInstallExtension";
import isDesktopApp from "@lichtblick/suite-base/util/isDesktopApp";

const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});

const columnHelper = createColumnHelper<typeof features, Immutable<ExtensionMarketplaceDetail>>();

const CHECKBOX_COLUMN_WIDTH = 48;
// Relative column weights, turned into percentages of the visible columns.
const COLUMN_WEIGHTS: Record<string, number> = {
  name: 20,
  version: 10,
  publisher: 15,
  description: 35,
  actions: 20,
};

const useStyles = makeStyles()({
  table: {
    tableLayout: "fixed",
    "& td, & th": {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
  },
  row: {
    cursor: "pointer",
  },
});

export default function ExtensionList({
  namespace,
  entries,
  filterText,
  selectExtension,
}: Readonly<ExtensionListProps>): React.JSX.Element {
  const { t } = useTranslation("extensionsSettings");
  const { classes } = useStyles();
  const installedExtensions = useExtensionCatalog((state) => state.installedExtensions);
  const uninstallExtension = useExtensionCatalog((state) => state.uninstallExtension);
  const { enqueueSnackbar } = useSnackbar();
  const analytics = useAnalytics();
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [isBulkOperating, setIsBulkOperating] = useState(false);

  const { handleInstall, handleUninstall, operationStatus, isOperating } = useExtensionOperations();
  const isExtensionInstalled = useCallback(
    (id: string) =>
      installedExtensions?.some(
        (installed) => installed.id === id && installed.namespace === namespace,
      ) ?? false,
    [installedExtensions, namespace],
  );

  // Only count rows still in the list (a filter change can hide selected rows)
  const selectedExtensions = entries.filter((entry) => rowSelection[entry.id] === true);

  const handleBulkUninstall = useCallback(async () => {
    const extensionsToUninstall = selectedExtensions.filter((ext) => isExtensionInstalled(ext.id));

    if (extensionsToUninstall.length === 0) {
      enqueueSnackbar("No installed extensions to uninstall from selection", {
        variant: "info",
      });
      return;
    }

    setIsBulkOperating(true);

    let successCount = 0;
    let failCount = 0;

    for (const extension of extensionsToUninstall) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 100));
        await uninstallExtension(extension.namespace ?? "local", extension.id);
        successCount++;
        analytics.logEvent(AppEvent.EXTENSION_UNINSTALL, {
          type: extension.id,
        });
      } catch (error) {
        console.error("Failed to uninstall extension:", error);
        failCount++;
      }
    }

    if (successCount > 0) {
      enqueueSnackbar(`${successCount} extension(s) uninstalled successfully`, {
        variant: "success",
      });
    }
    if (failCount > 0) {
      enqueueSnackbar(`${failCount} extension(s) failed to uninstall`, {
        variant: "error",
      });
    }

    setIsBulkOperating(false);
    setRowSelection({});
  }, [analytics, enqueueSnackbar, isExtensionInstalled, selectedExtensions, uninstallExtension]);

  const columns = useMemo(() => {
    const all = columnHelper.columns([
      columnHelper.accessor("name", { header: "Name" }),
      columnHelper.accessor("version", { header: "Version" }),
      columnHelper.accessor("publisher", { header: "Publisher" }),
      columnHelper.accessor("description", { header: "Description" }),
      columnHelper.display({
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const extension = row.original as ExtensionMarketplaceDetail;
          const isExtensionOperating = isOperating(extension.id);
          return isExtensionInstalled(extension.id) ? (
            <UninstallButton
              extension={extension}
              onAction={handleUninstall}
              isOperating={isExtensionOperating}
              operationStatus={operationStatus}
              stopPropagation
              label={ExtensionActionsLabel.UNINSTALL}
              loadingLabel={ExtensionOperationStatusLabel.UNINSTALLING}
            />
          ) : (
            <InstallButton
              extension={extension}
              onAction={handleInstall}
              isOperating={isExtensionOperating}
              operationStatus={operationStatus}
              stopPropagation
              label={ExtensionActionsLabel.INSTALL}
              loadingLabel={ExtensionOperationStatusLabel.INSTALLING}
            />
          );
        },
      }),
    ]);
    const showActions = isDesktopApp() || !entries.some((entry) => canInstallExtension(entry));
    return showActions ? all : all.filter((column) => column.id !== "actions");
  }, [entries, handleInstall, handleUninstall, isExtensionInstalled, isOperating, operationStatus]);

  const table = useTable({
    features,
    columns,
    data: entries,
    getRowId: (row) => row.id,
    initialState: { pagination: initialPagination },
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
  });

  const renderComponent = () => {
    if (entries.length === 0 && filterText) {
      return generatePlaceholderList(t("noExtensionsFound"));
    } else if (entries.length === 0) {
      return generatePlaceholderList(t("noExtensionsAvailable"));
    }

    const selectedInstalled = selectedExtensions.filter((ext) => isExtensionInstalled(ext.id));

    return (
      <Stack gap={1}>
        <Stack direction="row" gap={1} paddingX={2}>
          <Typography
            variant="body2"
            style={{
              visibility: selectedInstalled.length > 0 ? "visible" : "hidden",
            }}
            sx={{
              color: "text.secondary",
              alignSelf: "center",
              paddingY: 1,
            }}
          >
            {selectedExtensions.length} selected
          </Typography>
          {selectedInstalled.length > 0 && (
            <Button
              size="small"
              color="inherit"
              variant="outlined"
              onClick={handleBulkUninstall}
              disabled={isBulkOperating}
            >
              {isBulkOperating
                ? ExtensionOperationStatusLabel.UNINSTALLING
                : `${ExtensionActionsLabel.UNINSTALL} ${selectedInstalled.length}`}
            </Button>
          )}
        </Stack>
        <div>
          <Table className={classes.table}>
            <TableHead>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  <TableCell padding="checkbox" style={{ width: CHECKBOX_COLUMN_WIDTH }}>
                    <Checkbox
                      size="small"
                      checked={table.getIsAllRowsSelected()}
                      indeterminate={table.getIsSomeRowsSelected()}
                      onChange={table.getToggleAllRowsSelectedHandler()}
                      slotProps={{ input: { "aria-label": "Select all rows" } }}
                    />
                  </TableCell>
                  {headerGroup.headers.map((header, _index, headers) => {
                    const totalWeight = headers.reduce(
                      (sum, { column }) => sum + (COLUMN_WEIGHTS[column.id] ?? 0),
                      0,
                    );
                    const sorted = header.column.getIsSorted();
                    return (
                      <TableCell
                        key={header.id}
                        style={{
                          width: `${((COLUMN_WEIGHTS[header.column.id] ?? 0) / totalWeight) * 100}%`,
                        }}
                        sortDirection={sorted === false ? false : sorted}
                      >
                        {header.column.getCanSort() ? (
                          <TableSortLabel
                            active={sorted !== false}
                            direction={sorted === false ? "asc" : sorted}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </TableSortLabel>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableHead>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  hover
                  selected={row.getIsSelected()}
                  className={classes.row}
                  data-testid="extension-list-entry"
                  onClick={() => {
                    const extension = row.original as ExtensionMarketplaceDetail;
                    const isInstalled =
                      installedExtensions?.some(
                        (installed) =>
                          installed.id === extension.id &&
                          installed.namespace === extension.namespace,
                      ) ?? false;
                    selectExtension({
                      installed: isInstalled,
                      entry: extension,
                    });
                  }}
                >
                  <TableCell
                    padding="checkbox"
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    <Checkbox
                      size="small"
                      checked={row.getIsSelected()}
                      onChange={row.getToggleSelectedHandler()}
                      slotProps={{ input: { "aria-label": "Select row" } }}
                    />
                  </TableCell>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={entries.length}
            page={table.state.pagination.pageIndex}
            rowsPerPage={table.state.pagination.pageSize}
            rowsPerPageOptions={[5, 10, 20]}
            onPageChange={(_event, page) => {
              table.setPageIndex(page);
            }}
            onRowsPerPageChange={(event) => {
              table.setPageSize(Number(event.target.value));
            }}
          />
        </div>
      </Stack>
    );
  };

  return (
    <Stack key={namespace} gap={1} paddingBottom={2}>
      <Stack paddingY={0} paddingX={2}>
        <Typography
          component="div"
          variant="overline"
          sx={{
            color: "text.secondary",
          }}
        >
          {displayNameForNamespace(namespace)}
        </Typography>
      </Stack>
      {renderComponent()}
    </Stack>
  );
}
