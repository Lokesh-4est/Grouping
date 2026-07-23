/* global TrimbleConnectWorkspace */

(() => {
  "use strict";

  const state = {
    api: null,
    models: [],
    layerIndex: [],
    groups: [],
    activeGroupId: null,
    lastResolvedEntities: [],
    extensionAppliedIsolation: false,
    objectLayerCache: new Map(),
    busy: false,
    activationSequence: 0
  };

  const elements = {};
  let statusTimer = null;

  document.addEventListener("DOMContentLoaded", initialise);

  async function initialise() {
    cacheElements();
    bindEvents();

    if (!window.TrimbleConnectWorkspace) {
      showStatus(
        "Trimble Connect Workspace API failed to load.",
        true,
        0
      );

      renderLayerList();
      return;
    }

    try {
      state.api =
        await TrimbleConnectWorkspace.connect(
          window.parent,
          handleWorkspaceEvent,
          30000
        );

      await refreshLayers();

      showStatus(
        "Connected. Select layers to create a group."
      );
    } catch (error) {
      console.error(error);

      showStatus(
        `Could not connect: ${messageOf(error)}`,
        true,
        0
      );

      elements.layerList.innerHTML =
        '<div class="empty-state">Open this page as a Trimble Connect 3D Viewer extension.</div>';
    } finally {
      setBusy(false);
    }
  }

  function cacheElements() {
    elements.refreshButton =
      document.getElementById("refreshButton");

    elements.layerSearch =
      document.getElementById("layerSearch");

    elements.layerList =
      document.getElementById("layerList");

    elements.groupName =
      document.getElementById("groupName");

    elements.createGroupButton =
      document.getElementById(
        "createGroupButton"
      );

    elements.groupList =
      document.getElementById("groupList");

    elements.isolateToggle =
      document.getElementById(
        "isolateToggle"
      );

    elements.clearSelectionButton =
      document.getElementById(
        "clearSelectionButton"
      );

    elements.status =
      document.getElementById("status");
  }

  function bindEvents() {
    elements.refreshButton.addEventListener(
      "click",
      refreshLayers
    );

    elements.layerSearch.addEventListener(
      "input",
      renderLayerList
    );

    elements.createGroupButton.addEventListener(
      "click",
      createGroup
    );

    elements.clearSelectionButton.addEventListener(
      "click",
      clearGroupSelection
    );

    elements.isolateToggle.addEventListener(
      "change",
      handleIsolateToggle
    );
  }

  function handleWorkspaceEvent(event) {
    if (
      event ===
        "viewer.onModelStateChanged" ||
      event === "viewer.onModelReset" ||
      event === "project.onChanged"
    ) {
      window.setTimeout(
        () => refreshLayers(false),
        250
      );
    }
  }

  async function refreshLayers(
    showConfirmation = true
  ) {
    if (!state.api || state.busy) {
      return;
    }

    try {
      setBusy(true);

      elements.layerList.innerHTML =
        '<div class="empty-state">Reading loaded models and layers…</div>';

      const models =
        await state.api.viewer.getModels(
          "loaded"
        );

      state.models =
        Array.isArray(models)
          ? models
          : [];

      const results =
        await Promise.all(
          state.models.map(
            async (model) => {
              const modelId =
                viewerModelId(model);

              try {
                const layers =
                  await state.api.viewer.getLayers(
                    modelId
                  );

                return (layers || []).map(
                  (layer) => ({
                    key:
                      `${modelId}::${layer.name}`,

                    modelId,

                    modelName:
                      model.name ||
                      model.id ||
                      modelId,

                    layerName:
                      layer.name,

                    visible:
                      layer.visible !== false
                  })
                );
              } catch (error) {
                console.warn(
                  "Could not read layers for",
                  model.name,
                  error
                );

                return [];
              }
            }
          )
        );

      state.layerIndex =
        results
          .flat()
          .sort(compareLayers);

      state.objectLayerCache.clear();

      renderLayerList();
      renderGroups();

      if (showConfirmation) {
        showStatus(
          `Loaded ${state.layerIndex.length} layer${
            state.layerIndex.length === 1
              ? ""
              : "s"
          } from ${state.models.length} model${
            state.models.length === 1
              ? ""
              : "s"
          }.`
        );
      }
    } catch (error) {
      console.error(error);

      state.layerIndex = [];
      state.objectLayerCache.clear();

      renderLayerList();

      showStatus(
        `Could not refresh layers: ${messageOf(error)}`,
        true
      );
    } finally {
      setBusy(false);
    }
  }

  function renderLayerList() {
    const search =
      normalise(
        elements.layerSearch.value
      );

    const filtered =
      state.layerIndex.filter(
        (item) =>
          !search ||
          normalise(
            item.layerName
          ).includes(search) ||
          normalise(
            item.modelName
          ).includes(search)
      );

    if (!filtered.length) {
      elements.layerList.innerHTML =
        state.layerIndex.length
          ? '<div class="empty-state">No layers match your search.</div>'
          : '<div class="empty-state">No layers found. Load model files, then refresh.</div>';

      return;
    }

    const grouped = new Map();

    for (const layer of filtered) {
      if (
        !grouped.has(layer.modelId)
      ) {
        grouped.set(
          layer.modelId,
          {
            modelName:
              layer.modelName,

            layers: []
          }
        );
      }

      grouped
        .get(layer.modelId)
        .layers.push(layer);
    }

    elements.layerList.innerHTML = "";

    for (
      const group of
      grouped.values()
    ) {
      const block =
        document.createElement("div");

      block.className = "model-block";

      const title =
        document.createElement("div");

      title.className = "model-title";
      title.textContent =
        group.modelName;

      title.title =
        group.modelName;

      block.appendChild(title);

      for (
        const layer of
        group.layers
      ) {
        const label =
          document.createElement("label");

        label.className = "layer-row";

        const checkbox =
          document.createElement("input");

        checkbox.type = "checkbox";

        checkbox.className =
          "layer-checkbox";

        checkbox.value = layer.key;

        checkbox.dataset.modelId =
          layer.modelId;

        checkbox.dataset.modelName =
          layer.modelName;

        checkbox.dataset.layerName =
          layer.layerName;

        const name =
          document.createElement("span");

        name.className = "layer-name";

        name.textContent =
          layer.layerName;

        label.append(
          checkbox,
          name
        );

        block.appendChild(label);
      }

      elements.layerList.appendChild(
        block
      );
    }
  }

  function createGroup() {
    const name =
      elements.groupName.value.trim();

    const selected = [
      ...document.querySelectorAll(
        ".layer-checkbox:checked"
      )
    ];

    const selectedMode =
      document.querySelector(
        'input[name="matchMode"]:checked'
      );

    if (!selectedMode) {
      showStatus(
        "Select a grouping mode.",
        true
      );

      return;
    }

    const matchMode =
      selectedMode.value;

    if (!name) {
      showStatus(
        "Enter a group name.",
        true
      );

      elements.groupName.focus();
      return;
    }

    const duplicateExists =
      state.groups.some(
        (group) =>
          group.name.localeCompare(
            name,
            undefined,
            {
              sensitivity: "accent"
            }
          ) === 0
      );

    if (duplicateExists) {
      showStatus(
        "A group with this name already exists in the current session.",
        true
      );

      return;
    }

    if (!selected.length) {
      showStatus(
        "Select at least one layer.",
        true
      );

      return;
    }

    let targets =
      selected.map(
        (checkbox) => ({
          modelId:
            checkbox.dataset.modelId,

          modelName:
            checkbox.dataset.modelName,

          layerName:
            checkbox.dataset.layerName
        })
      );

    targets = uniqueTargets(
      targets,
      matchMode
    );

    state.groups.push({
      id: makeId(),
      name,
      matchMode,
      targets
    });

    elements.groupName.value = "";

    document
      .querySelectorAll(
        ".layer-checkbox:checked"
      )
      .forEach((item) => {
        item.checked = false;
      });

    renderGroups();

    showStatus(
      `Group “${name}” created for this session.`
    );
  }

  function uniqueTargets(
    targets,
    matchMode
  ) {
    const seen = new Set();

    return targets.filter(
      (target) => {
        const key =
          matchMode ===
          "layer-name-all-files"
            ? normalise(
                target.layerName
              )
            : `${target.modelId}::${normalise(
                target.layerName
              )}`;

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      }
    );
  }

  function renderGroups() {
    if (!state.groups.length) {
      elements.groupList.innerHTML =
        '<div class="empty-state">No groups created yet.</div>';

      return;
    }

    elements.groupList.innerHTML = "";

    for (
      const group of
      state.groups
    ) {
      const card =
        document.createElement("div");

      card.className =
        `group-card${
          group.id ===
          state.activeGroupId
            ? " active"
            : ""
        }`;

      const main =
        document.createElement("button");

      main.type = "button";
      main.className = "group-main";

      main.addEventListener(
        "click",
        () => activateGroup(group.id)
      );

      const groupName =
        document.createElement("span");

      groupName.className =
        "group-name";

      groupName.textContent =
        group.name;

      const meta =
        document.createElement("span");

      meta.className = "group-meta";

      if (
        group.matchMode ===
        "layer-name-all-files"
      ) {
        meta.textContent =
          `${group.targets.length} layer name${
            group.targets.length === 1
              ? ""
              : "s"
          } · all files`;
      } else {
        meta.textContent =
          `${group.targets.length} file/layer target${
            group.targets.length === 1
              ? ""
              : "s"
          }`;
      }

      main.append(
        groupName,
        meta
      );

      const actions =
        document.createElement("div");

      actions.className =
        "group-actions";

      const rename =
        document.createElement("button");

      rename.type = "button";
      rename.className =
        "group-action";

      rename.textContent =
        "Rename";

      rename.addEventListener(
        "click",
        () => renameGroup(group.id)
      );

      const remove =
        document.createElement("button");

      remove.type = "button";

      remove.className =
        "group-action delete";

      remove.textContent =
        "Delete";

      remove.addEventListener(
        "click",
        () => deleteGroup(group.id)
      );

      actions.append(
        rename,
        remove
      );

      card.append(
        main,
        actions
      );

      elements.groupList.appendChild(
        card
      );
    }
  }

  function renameGroup(groupId) {
    const group =
      state.groups.find(
        (item) =>
          item.id === groupId
      );

    if (!group) {
      return;
    }

    const nextName =
      window.prompt(
        "New group name:",
        group.name
      );

    if (nextName === null) {
      return;
    }

    const trimmed =
      nextName.trim();

    if (!trimmed) {
      showStatus(
        "Group name cannot be blank.",
        true
      );

      return;
    }

    const duplicateExists =
      state.groups.some(
        (item) =>
          item.id !== groupId &&
          item.name.localeCompare(
            trimmed,
            undefined,
            {
              sensitivity: "accent"
            }
          ) === 0
      );

    if (duplicateExists) {
      showStatus(
        "A group with this name already exists.",
        true
      );

      return;
    }

    group.name = trimmed;

    renderGroups();
  }

  async function deleteGroup(groupId) {
    const group =
      state.groups.find(
        (item) =>
          item.id === groupId
      );

    if (!group) {
      return;
    }

    const wasActive =
      state.activeGroupId ===
      groupId;

    state.groups =
      state.groups.filter(
        (item) =>
          item.id !== groupId
      );

    if (wasActive) {
      await clearGroupSelection();
    }

    renderGroups();

    showStatus(
      `Group “${group.name}” deleted.`
    );
  }

  async function activateGroup(groupId) {
    if (!state.api || state.busy) {
      return;
    }

    const group =
      state.groups.find(
        (item) =>
          item.id === groupId
      );

    if (!group) {
      return;
    }

    const activationId =
      ++state.activationSequence;

    try {
      setBusy(true);

      showStatus(
        `Finding objects for “${group.name}”…`,
        false,
        0
      );

      const entities =
        await resolveGroupEntities(
          group
        );

      if (
        activationId !==
        state.activationSequence
      ) {
        return;
      }

      if (
        !entities.length ||
        entities.every(
          (item) =>
            !item.entityIds.length
        )
      ) {
        showStatus(
          `No selectable objects were found for “${group.name}”.`,
          true
        );

        return;
      }

      const selector = {
        modelObjectIds:
          entities.map(
            (item) => ({
              modelId:
                item.modelId,

              objectRuntimeIds:
                item.entityIds,

              recursive: false
            })
          )
      };

      await state.api.viewer.setSelection(
        selector,
        "set"
      );

      if (
        elements.isolateToggle.checked
      ) {
        await state.api.viewer.isolateEntities(
          entities
        );

        state.extensionAppliedIsolation =
          true;
      } else if (
        state.extensionAppliedIsolation
      ) {
        await clearExtensionIsolation();
      }

      state.activeGroupId =
        group.id;

      state.lastResolvedEntities =
        entities;

      renderGroups();

      const count =
        entities.reduce(
          (sum, item) =>
            sum +
            item.entityIds.length,
          0
        );

      showStatus(
        `${count} object${
          count === 1 ? "" : "s"
        } selected from “${group.name}”.`
      );
    } catch (error) {
      console.error(error);

      showStatus(
        `Could not select the group: ${messageOf(error)}`,
        true,
        7000
      );
    } finally {
      setBusy(false);
    }
  }

  async function resolveGroupEntities(
    group
  ) {
    const loadedModels =
      await state.api.viewer.getModels(
        "loaded"
      );

    const targetNames =
      new Set(
        group.targets.map(
          (target) =>
            normalise(
              target.layerName
            )
        )
      );

    const fileTargets =
      new Map();

    if (
      group.matchMode ===
      "file-layer"
    ) {
      for (
        const target of
        group.targets
      ) {
        if (
          !fileTargets.has(
            target.modelId
          )
        ) {
          fileTargets.set(
            target.modelId,
            new Set()
          );
        }

        fileTargets
          .get(target.modelId)
          .add(
            normalise(
              target.layerName
            )
          );
      }
    }

    const resolved = [];

    for (
      const model of
      loadedModels || []
    ) {
      const modelId =
        viewerModelId(model);

      const wantedNames =
        group.matchMode ===
        "layer-name-all-files"
          ? targetNames
          : fileTargets.get(modelId);

      if (
        !wantedNames ||
        !wantedNames.size
      ) {
        continue;
      }

      const layerMap =
        await getObjectLayerMap(
          modelId
        );

      const ids = [];

      for (
        const wantedName of
        wantedNames
      ) {
        const layerIds =
          layerMap.get(
            wantedName
          );

        if (layerIds) {
          ids.push(...layerIds);
        }
      }

      const uniqueIds = [
        ...new Set(ids)
      ];

      if (uniqueIds.length) {
        resolved.push({
          modelId,
          entityIds:
            uniqueIds
        });
      }
    }

    if (!resolved.length) {
      throw new Error(
        "No object-to-layer mapping was found. " +
        "The complete file was not selected. " +
        "Open the browser console to see the layer-property diagnostic."
      );
    }

    return resolved;
  }

  /*
   * Trimble returns layer names and visibility,
   * but does not return the object IDs assigned
   * to each layer.
   *
   * This builds:
   *
   * Layer name -> object runtime IDs
   *
   * There is deliberately no whole-model
   * fallback.
   */
  async function getObjectLayerMap(
    modelId
  ) {
    if (
      state.objectLayerCache.has(
        modelId
      )
    ) {
      return state.objectLayerCache.get(
        modelId
      );
    }

    showStatus(
      "Reading object layer properties…",
      false,
      0
    );

    const groups =
      await state.api.viewer.getObjects({
        modelObjectIds: [
          {
            modelId,
            recursive: true
          }
        ]
      });

    const basicObjects = [];

    for (
      const group of
      groups || []
    ) {
      if (
        group.modelId !==
        modelId
      ) {
        continue;
      }

      for (
        const object of
        group.objects || []
      ) {
        if (
          Number.isFinite(
            object.id
          )
        ) {
          basicObjects.push(
            object
          );
        }
      }
    }

    const objectIds = [
      ...new Set(
        basicObjects.map(
          (object) =>
            object.id
        )
      )
    ];

    if (!objectIds.length) {
      console.warn(
        "4EST Layer Groups: no objects returned for model",
        modelId
      );

      const emptyMap =
        new Map();

      state.objectLayerCache.set(
        modelId,
        emptyMap
      );

      return emptyMap;
    }

    const detailedObjects = [];
    const batchSize = 500;

    for (
      let start = 0;
      start < objectIds.length;
      start += batchSize
    ) {
      const batchIds =
        objectIds.slice(
          start,
          start + batchSize
        );

      const batch =
        await state.api.viewer
          .getObjectProperties(
            modelId,
            batchIds
          );

      if (Array.isArray(batch)) {
        detailedObjects.push(
          ...batch
        );
      }
    }

    const objectsToInspect =
      detailedObjects.length
        ? detailedObjects
        : basicObjects;

    const layerMap =
      new Map();

    const diagnosticNames =
      new Set();

    for (
      const object of
      objectsToInspect
    ) {
      const layerValues =
        extractLayerValues(
          object,
          diagnosticNames
        );

      for (
        const layerValue of
        layerValues
      ) {
        if (
          !layerMap.has(
            layerValue
          )
        ) {
          layerMap.set(
            layerValue,
            []
          );
        }

        layerMap
          .get(layerValue)
          .push(object.id);
      }
    }

    for (
      const [
        layerName,
        ids
      ] of layerMap.entries()
    ) {
      layerMap.set(
        layerName,
        [...new Set(ids)]
      );
    }

    if (!layerMap.size) {
      console.warn(
        "4EST Layer Groups: no layer property was found",
        {
          modelId,

          availablePropertyPaths: [
            ...diagnosticNames
          ].sort()
        }
      );
    } else {
      console.info(
        "4EST Layer Groups: object-to-layer map created",
        {
          modelId,

          layers: [
            ...layerMap.entries()
          ].map(
            ([name, ids]) => ({
              layer: name,

              objectCount:
                ids.length
            })
          )
        }
      );
    }

    state.objectLayerCache.set(
      modelId,
      layerMap
    );

    return layerMap;
  }

  function extractLayerValues(
    object,
    diagnosticNames
  ) {
    const values = new Set();

    for (
      const propertySet of
      object.properties || []
    ) {
      const setName =
        String(
          propertySet.set || ""
        );

      const normalisedSet =
        normalisePropertyKey(
          setName
        );

      for (
        const property of
        propertySet.properties || []
      ) {
        const propertyName =
          String(
            property.name || ""
          );

        const normalisedName =
          normalisePropertyKey(
            propertyName
          );

        const propertyPath =
          setName
            ? `${setName}.${propertyName}`
            : propertyName;

        if (propertyPath) {
          diagnosticNames.add(
            propertyPath
          );
        }

        if (
          isLayerProperty(
            normalisedSet,
            normalisedName
          ) &&
          property.value !==
            undefined &&
          property.value !==
            null &&
          String(
            property.value
          ).trim()
        ) {
          values.add(
            normalise(
              property.value
            )
          );
        }
      }
    }

    return values;
  }

  function isLayerProperty(
    setName,
    propertyName
  ) {
    if (
      propertyName.includes(
        "LAYER"
      )
    ) {
      return true;
    }

    return (
      setName.includes("LAYER") &&
      (
        propertyName === "NAME" ||
        propertyName === "VALUE" ||
        propertyName === "ID" ||
        propertyName ===
          "LAYERNAME"
      )
    );
  }

  function normalisePropertyKey(
    value
  ) {
    return String(value || "")
      .trim()
      .toLocaleUpperCase()
      .replace(
        /[^A-Z0-9]/g,
        ""
      );
  }

  async function handleIsolateToggle() {
    if (!state.api || state.busy) {
      return;
    }

    try {
      setBusy(true);

      if (
        elements.isolateToggle.checked
      ) {
        if (
          !state.lastResolvedEntities
            .length
        ) {
          elements.isolateToggle.checked =
            false;

          showStatus(
            "Select a group before turning on isolation.",
            true
          );

          return;
        }

        await state.api.viewer.isolateEntities(
          state.lastResolvedEntities
        );

        state.extensionAppliedIsolation =
          true;

        showStatus(
          "Selected group isolated."
        );
      } else {
        await clearExtensionIsolation();

        showStatus(
          "Isolation cleared."
        );
      }
    } catch (error) {
      console.error(error);

      elements.isolateToggle.checked =
        !elements.isolateToggle.checked;

      showStatus(
        `Could not change isolation: ${messageOf(error)}`,
        true
      );
    } finally {
      setBusy(false);
    }
  }

  async function clearExtensionIsolation() {
    if (
      !state.extensionAppliedIsolation
    ) {
      return;
    }

    await state.api.viewer.setObjectState(
      undefined,
      {
        visible: "reset"
      }
    );

    for (
      const model of
      state.models
    ) {
      const modelId =
        viewerModelId(model);

      const snapshot =
        state.layerIndex
          .filter(
            (layer) =>
              layer.modelId ===
              modelId
          )
          .map(
            (layer) => ({
              name:
                layer.layerName,

              visible:
                layer.visible
            })
          );

      if (snapshot.length) {
        await state.api.viewer
          .setLayersVisibility(
            modelId,
            snapshot
          );
      }
    }

    state.extensionAppliedIsolation =
      false;
  }

  async function clearGroupSelection() {
    if (!state.api || state.busy) {
      return;
    }

    try {
      setBusy(true);

      state.activationSequence += 1;

      await state.api.viewer
        .setSelection(
          {
            modelObjectIds: []
          },
          "set"
        );

      if (
        state.extensionAppliedIsolation
      ) {
        await clearExtensionIsolation();
      }

      state.activeGroupId = null;

      state.lastResolvedEntities = [];

      elements.isolateToggle.checked =
        false;

      renderGroups();

      showStatus(
        "Group selection cleared."
      );
    } catch (error) {
      console.error(error);

      showStatus(
        `Could not clear selection: ${messageOf(error)}`,
        true
      );
    } finally {
      setBusy(false);
    }
  }

  function setBusy(value) {
    state.busy = value;

    elements.refreshButton.disabled =
      value;

    elements.createGroupButton.disabled =
      value;
  }

  function showStatus(
    message,
    isError = false,
    duration = 4000
  ) {
    window.clearTimeout(
      statusTimer
    );

    elements.status.textContent =
      message;

    elements.status.className =
      `status show${
        isError
          ? " error"
          : ""
      }`;

    if (duration > 0) {
      statusTimer =
        window.setTimeout(
          () => {
            elements.status.className =
              "status";
          },
          duration
        );
    }
  }

  function viewerModelId(model) {
    return (
      model.versionId ||
      model.id
    );
  }

  function normalise(value) {
    return String(value || "")
      .trim()
      .toLocaleUpperCase();
  }

  function compareLayers(a, b) {
    const modelCompare =
      a.modelName.localeCompare(
        b.modelName
      );

    return (
      modelCompare ||
      a.layerName.localeCompare(
        b.layerName
      )
    );
  }

  function makeId() {
    if (
      window.crypto &&
      typeof window.crypto
        .randomUUID ===
        "function"
    ) {
      return window.crypto.randomUUID();
    }

    return (
      `group-${Date.now()}-` +
      Math.random()
        .toString(16)
        .slice(2)
    );
  }

  function messageOf(error) {
    return (
      error &&
      error.message
        ? error.message
        : String(error)
    );
  }
})();
