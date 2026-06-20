# 3D Model Creator — Blender Style

A web-based 3D modeler with Blender-style shortcuts and controls. Build 3D geometry in your browser and export it as `.glb` for use in Blender or other 3D tools.

> ⚠️ **Important — after importing the exported model into Blender:** You **must** run
> **Edit Mode → Mesh → Clean Up → Merge Vertices by Distance**, or the 3D model
> imported from this program will not work. You will also need to first add and
> **apply a Subdivision Surface modifier**, then a **Remesh (Voxel) modifier**, in
> order to get somewhat workable, mostly-quads topology.

---

## Requirements

- **Node.js** (v16 or newer) — [Download Node.js](https://nodejs.org/)
- **npm** (comes with Node.js)
- Any **web browser** — the app opens in your **default web browser** (Vivaldi, Edge, Brave, Coc Coc, Chrome, Firefox, etc.). Nothing is hard-coded to Chrome.

The only dependencies are **Three.js** and **Vite** (dev server), installed via npm.

---

## Installation

1. **Download the project from GitHub.** On the repository page, click **Code → Download ZIP** (or `git clone https://github.com/motdub/3d_Model_Blender_Replace.git`).
2. **Put the folder at exactly `C:\3d-model-creator`.** If you downloaded the ZIP, extract it so that the files (`index.html`, `main.js`, `launch.bat`, etc.) live directly inside `C:\3d-model-creator`.
3. **Open PowerShell** and run exactly:

   ```powershell
   cd C:\3d-model-creator
   .\launch.bat
   ```

That's it. `launch.bat` installs dependencies the first time, starts the dev server, and opens the app in your **default web browser** at **http://localhost:5173/**. Press **Ctrl+C** in the launcher window to stop the server.

---

## Closing the program

When you want to **close/stop the program**, open **PowerShell** (or the **VS Code terminal**) — the window that is running the server — and press **Ctrl + C**. This stops the Vite dev server. You can then close the browser tab.

---

## Quick Start


### Easiest — double-click `launch.bat`

1. Download/clone this repository.
2. Double-click **`launch.bat`** in the project folder.

`launch.bat` automatically:
- installs dependencies the first time (`npm install`),
- starts the Vite dev server,
- opens the app at **http://localhost:5173/** in your **default web browser**.

Press **Ctrl+C** in the launcher window to stop the server.

### Alternative — copy/paste PowerShell commands

Open **`launch-commands.txt`**, copy one of the ready-made command blocks, paste it into **PowerShell**, and press Enter. It starts the server and opens the correct page automatically. (Remember to edit the `cd` path to where you put the project.)

### Manual setup

```powershell
cd path\to\3d-model-creator
npm install
npm run dev
```

Then open **http://localhost:5173/** in your browser.

---

## Controls

All controls are **keyboard + mouse** (no GUI button required). A complete, always-visible list is shown in the **top-right Controls panel** in the app. The **top-left HUD** shows the live Mode / Tool / Selection status and the GUI buttons (Export, Import Ref Image, Wireframe toggle, opacity sliders).

### Selection Mode

| Key | Action |
|-----|--------|
| **1** | Vertex select mode |
| **2** | Edge select mode |
| **3** | Face select mode |

### Display & View

| Key | Action |
|-----|--------|
| **4** | Toggle **Wireframe mode** (see below) |
| **5** | Toggle **Perspective / Orthographic** projection |

### Navigation Gizmo (top-right axis compass)

| Control | Action |
|---------|--------|
| **Click X** (red) | Snap to **Side** view (flat orthographic) |
| **Click Y** (green) | Snap to **Top** view (flat orthographic) |
| **Click Z** (blue) | Snap to **Front** view (flat orthographic) |
| **Click again** | Flip to the opposite side (+/−) of that axis |
| **Click center** | Toggle **Perspective / Orthographic** |


### Select

| Control | Action |
|---------|--------|
| **Left Click** | Select element |
| **Shift + Left Click** | Add / remove from selection |
| **A** | Select all |
| **B** | Box select (drag, click to finish) |

### Transform (flat by default)

| Key | Action |
|-----|--------|
| **G** | Grab / Move — slides **flat along the ground (XZ)** so geometry stays 2D against your reference image |
| **R** | Rotate |
| **S** | Scale |
| **X / Y / Z** | Lock to an axis. Use **Y** or **Z** to deliberately move **vertically** |
| **Left Click** | Confirm transform |
| **Right Click / Esc** | Cancel transform |

### Modeling

| Key | Action |
|-----|--------|
| **E** | Extrude (stays flat, then auto-grabs the new geometry) |
| **W** | **Subdivide** selected edges/faces (adds more geometry) |
| **K** | **Knife** — click edges to cut new vertices/edges; **Enter/Esc** finishes |
| **F** | Fill (edge / triangle / quad) |
| **M** | Merge selected vertices |
| **X** | Delete selected |
| **Ctrl + Z** | Undo |
| **Right Click** | Open the **context menu** (Subdivide, Knife, Extrude, Fill, Merge, Delete, Wireframe) |

### Camera & 3D Cursor

| Control | Action |
|---------|--------|
| **Middle Drag** | Orbit the camera **around the 3D cursor** |
| **Scroll** | Zoom in / out |
| **Shift + Right Click** | Place the 3D cursor (the camera's orbit pivot) on a surface or the ground |
| **Shift + Left Click** (empty space) | Place the 3D cursor |
| **Shift + Middle Drag** (Perspective) | Slide the 3D cursor along surfaces in real time |
| **Shift + Middle Drag** (Orthographic) | **Pan the flat 2D view** like an image — the 3D cursor rides along and re-centers as the orbit pivot, so you can immediately Middle-drag to rotate around it |
| **Arrow Keys** | Fly forward / back / strafe |
| **PageUp / PageDown** | Fly up / down |

> Fly navigation uses the **Arrow keys / PageUp / PageDown** (not WASD) so it never
> conflicts with tool shortcuts. This keeps the camera still while you model.

### Export

| Key | Action |
|-----|--------|
| **Ctrl + E** | Export `.glb` |

---

## Feature Notes

### Subdivide (add more geometry)
Press **W** or right-click → **Subdivide**.
- **Face mode:** each fully-selected face is split into 4 (edge midpoints + a center vertex).
- **Edge mode:** each selected edge is split at its midpoint.

### Knife tool
Press **K** or right-click → **Knife Cut**. Click on edges to drop new vertices; consecutive cuts split the shared face into two faces (or connect with a new edge). Press **Enter** or **Esc** (or **K** again / right-click) to finish.

### Flat (2D) movement
Grab (**G**) and **Extrude** (**E**) now slide **flat along the ground plane** so your geometry tracks the reference image instead of drifting up and down. To move vertically on purpose, start a Grab and press **Z** (or **Y**) to lock to the vertical axis.

### Navigation Gizmo & Orthographic views (copied from Blender)
A Blender-style **Navigation Compass / Axis Gizmo** lives in the **top-right corner** of the viewport — an interactive widget with labeled colored circles (**X** = red, **Y** = green, **Z** = blue) that rotate to match your camera.

- **Click a colored axis circle** to snap the camera to a perfectly flat, 2D projection looking straight down that axis: **X → Side**, **Y → Top**, **Z → Front**. Clicking the same circle again flips to the opposite side.
- Snapping automatically switches the viewport from **Perspective** (which has depth distortion) to **Orthographic** mode. In Orthographic mode parallel lines never converge, so you can move, scale, or extrude vertices **completely flat on a 2D plane** without accidentally warping them along the depth axis.
- The **center button** (or key **5**) toggles **Perspective ⇄ Orthographic** at any time.

> Note: this app is **Y-up** (Blender is Z-up), so the **Y** circle gives the top-down view and **Z** gives the front view.

#### Pan the 2D view (Orthographic)
While in **Orthographic** mode, **Shift + Middle-drag** pans the viewport flat, exactly like dragging a 2D image around. As you pan, the **3D cursor travels with the camera and stays pinned at the center of your view** — sitting on the correct depth along the axis you are looking down (right "under" you). Because the cursor is also the orbit pivot, you can then **Middle-drag (no Shift) to rotate** around that freshly re-centered point. In **Perspective** mode the same Shift + Middle-drag instead slides the 3D cursor along surfaces (unchanged).

### Wireframe display mode

Press **4** or click the **Wireframe** button (or right-click → **Toggle Wireframe**).
- Solid faces become hidden/transparent so you can see the **reference image underneath**.
- You still see all **points** and **lines (edges)**.
- A small **X marker** is drawn at the center of every triangle/quad so you can tell where filled faces exist.
- **Export always uses solid, real faces** for every triangle/quad — wireframe mode is display-only and does not affect the exported `.glb`.

### 3D cursor & orbit
The camera orbits around the **3D cursor**. Place the cursor with **Shift + Right Click** (snaps to a surface, or falls back to the ground plane so it always works — even with lots of geometry on screen), **Shift + Left Click** in empty space, or drag it with **Shift + Middle Drag**.

### Reference Images
Click **Import Ref Image** to load a `.png`/`.jpg` as a textured 4-point plane. The four corners are selectable/movable with **G / R / S** like normal vertices. Reference images are separate from the mesh and are **not** included in exports. Use the **Mesh** and **Img** opacity sliders to fine-tune visibility.

---

## Blender Import Workflow

After exporting your `.glb` and importing it into Blender:

### 1. Merge Vertices by Distance (REQUIRED)
```
Edit Mode → Mesh → Clean Up → Merge Vertices by Distance
```
> ⚠️ **You must do this**, or the 3D model imported from this program will not work.

### 2. Triangles to quads
```
Edit Mode → Face → Tris to Quads
```

### 3. Fill holes
Make sure the vertex count matches on all four sides, then:
```
Edit Mode → Face → Grid Fill
```
Or use the **Knife** tool to match point counts first.

### 4. Add more geometry and smooth
- **Shift + Alt + S** — to-sphere a circular selection.
- Add a **Subdivision Surface** modifier (2 levels), apply, then refine.
- If a texture distorts: `Edit Mode → UV → Project from View`.

### 5. Make holes
Use **Dissolve** or **Delete Faces**.

### 6. Fix stubborn triangles
Select the two triangles forming a square and **Dissolve Faces**.

### 7. Fix shading issues
Replace the material with a **Project from View** UV image texture.

---

## License

All rights reserved. You may not sell, modify, or distribute this code without permission from the author.
