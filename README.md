# 3D Model Creator — Blender Style

A web-based 3D modeler with Blender-style shortcuts and controls. Build 3D geometry in your browser and export it as `.glb` for use in Blender or other 3D tools.

---

## Requirements

- **Node.js** (v16 or newer) — [Download Node.js](https://nodejs.org/)
- **npm** (comes with Node.js)

The only dependency is **Three.js** (loaded via npm) and **Vite** (dev server).

---

## Setup & Run

### 1. Download the project

Download this repository as a `.zip` file from GitHub:

1. Go to the repo page
2. Click the green **Code** button
3. Click **Download ZIP**
4. Extract the `.zip` file to a folder of your choice

### 2. Install dependencies

Open **PowerShell** (or Command Prompt / Terminal) and navigate to the extracted folder:

```powershell
cd path\to\extracted\folder
```

Then install the required packages:

```powershell
npm install
```

### 3. Run the 3D modeler

```powershell
npm run dev
```

This starts a local development server. You will see output similar to:

```
  VITE v8.0.16  ready in 304 ms

  ➜  Local:   http://localhost:5173/
```

### 4. Open in your browser

Copy the link **http://localhost:5173/** from the terminal and paste it into your web browser's address bar. Press **Enter**.

### 5. Close the program

When finished, press **Ctrl+C** in the PowerShell terminal to stop the server.

---

## How to Use

### Controls (Blender Shortcuts)

| Key | Action |
|-----|--------|
| **1** | Vertex select mode |
| **2** | Edge select mode |
| **3** | Face select mode |
| **G** | Grab / Move selected |
| **R** | Rotate selected |
| **S** | Scale selected |
| **X / Y / Z** | Axis lock during transform |
| **B** | Box select |
| **A** | Select all |
| **E** | Extrude selected |
| **F** | Fill selected vertices |
| **M** | Merge selected vertices |
| **X** | Delete selected |
| **Esc** | Cancel transform |

### Mouse

| Action | Result |
|--------|--------|
| **Left Click** | Select (hold Shift for additive) |
| **Middle Drag** | Orbit camera |
| **Shift + Middle Drag** | Move 3D cursor along surfaces |
| **Scroll** | Zoom |
| **Shift + Right Click** | Place 3D cursor on mesh/reference image surface |

### UI

- **Export .glb** — Exports geometry for use in Blender
- **Import Ref Image** — Import a `.png` or `.jpg` as a 4-point reference plane (corners can be moved independently)
- **Mesh slider** — Adjust transparency of the 3D mesh (0%–100%)
- **Img slider** — Adjust transparency of reference images (0%–100%)

### Reference Images

Click **Import Ref Image** to load a `.png` or `.jpg` as a textured plane in the 3D scene. The four corner points can be selected and moved using the same **G** / **R** / **S** tools as regular vertices. Reference images are completely separate from the 3D geometry and are not included in exports.

### Fill Tips

If **F** (fill) with 4 selected vertices creates bad geometry, instead select **3 vertices at a time** and press **F** to create individual triangles. Two triangles can later be turned into a quad in Blender. This is useful when connecting separated parts of the mesh together.

### 3D Cursor

The 3D cursor snaps to mesh surfaces and reference image planes. It will not float in empty space. **Shift + Right Click** places it on the closest surface, and **Shift + Middle Drag** tracks it across surfaces in real-time.

---

## Blender Import Workflow

After exporting your `.glb` file and importing it into Blender, follow these steps for perfect topology:

### 1. Merge vertices by distance
```
Edit Mode → Mesh → Clean Up → Merge by Distance
```
> This is required or the model will not work properly.

### 2. Triangles to quads
```
Edit Mode → Face → Tris to Quads
```

### 3. Fill holes
To fill a square hole, make sure the number of vertices is the same on all four sides, then:
```
Edit Mode → Face → Grid Fill
```
Alternatively, use the **Knife** tool to make the point counts match on all four sides first.

### 4. Add more geometry and smooth
- **Shift + Alt + S** — Make a circular selection spherical (to sphere)
- If not smooth enough, add a **Subdivision Surface** modifier (2 levels), apply it, enter Edit Mode, Alt+Click the rough edge in edge or vertex mode, then **Shift + Alt + S** again
- If texture gets distorted: `Edit Mode → UV → Project from View`

### 5. Make holes
Use **Dissolve** or **Delete Faces** to create holes.

### 6. Fix stubborn triangles
If triangles won't turn into quads, select the two triangle faces that make up a square and **Dissolve Faces**. If a leftover single triangle remains, cut it in half and merge each half with its neighbors.

### 7. Fix shading issues
Replace the material with a **Project from View** UV image texture. Perfect topology every time.

---

## License

All rights reserved. You may not sell, modify, or distribute this code without permission from the author.