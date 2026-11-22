# 0022 A cut through the model

Status: Accepted

## Context

The viewport draws the outer surfaces of the sections, so the inside of a model is not seen: the rubber of a bushing between its sleeves, the inner layers of a sandwich spring, the stress inside a block under a rigid plate. *Min/Max* marks an extreme inside a body, but its surroundings are hidden. #395 asks for a cut of the view by a plane normal to x, y or z at a coordinate, with the hidden half chosen, through the **undeformed** model: in the results, the cut face is the face of the undeformed model, deformed with it, so it shows the same material points in every substep and at every scale.

What exists:

- **The surfaces are made in Python.** `felupe_studio.scene.surface()` triangulates the outer surface of the cells of a mesh with `triangulate_surface` of FElupe, region by region (the cells of the same tags), and `felupe_studio.results.scene()` that of every section of a result, subdivided for quadratic cells and cached per section. A surface of FElupe interpolates the values at the points of the mesh to its points with a sparse matrix (`interpolation`), so the curved faces of quadratic cells follow their shape functions.
- **The app draws them as they are,** as flat arrays of bytes: positions, triangles, faces, edges and owners (the cell of every triangle), with the displacements and the values of a result. The colors by sections and cell sets, the hover, the extremes and the picture of the view build on these arrays.
- **The vendored viewer** draws surfaces, lines and points (ADR 0004) and stays unchanged.

## Decision

- **The cut is made in Python and returned like the surfaces:** `felupe_studio.cuts.cut(surface, points, cells, cell_type, plane, order)` returns a `Cut` with the same arrays as a surface of FElupe (`interpolation`, `triangles`, `owners`, `faces`, `edges`) and the number of the triangles of the clipped outer surface (`outer`); the triangles of the cut face follow them. So everything that takes a surface takes a cut.
  - A cut is `{"axis": "x" | "y" | "z", "value": number, "half": "+" | "-"}`: `"+"` hides the half beyond the plane (x > value), `"-"` the half before it (x < value). It is a setting of the view, not of the project.
  - `scene.surface(solid, tags, cut)` cuts every region and gives the triangle of the outer surface of every triangle (`sources`, -1 on the cut face), `results.scene(..., cut)` the surfaces of the sections, and the request `result` takes `cut`.
- **The outer surface is clipped** at the plane: a triangle with all points kept stays, one with all points hidden is dropped, the others are clipped to a triangle or a quad of two triangles, with new points on their edges. The edges are clipped alike.
- **The cells are cut through their faces.** A cell that crosses the plane (its points on both sides, or the owner of a clipped triangle of the outer surface) is split into tetrahedrons: every triangle of every face of the cell with the center of the cell (the mean of its corners). The section of a tetrahedron by the plane is a triangle or a quad (marching tetrahedrons). The cut face is oriented towards the hidden half, without triangles of no area.
  - **A face is triangulated like the outer surface:** with the template of FElupe, from the ring of the face in its cell, subdivided for quadratic cells and interpolated by their shape functions. So the cut face meets the clipped outer surface without a gap, also at curved faces of quadratic cells.
  - **A quad of two cut cells is triangulated at its center** (of every subdivision) instead: the diagonal of a quad of FElupe depends on its ring, i.e. on the cell, and the two cells would cut a quad that is not plane along two different lines, a slit in the cut face.
- **The points of a cut are interpolated linearly** from the two points of their edge: a point at the parameter t = s<sub>a</sub> / (s<sub>a</sub> − s<sub>b</sub>) of the edge from a kept point a to a hidden point b, with the signed distances s to the plane, has the row (1 − t) row<sub>a</sub> + t row<sub>b</sub> of the interpolation. So the displacements and the values at the points follow, and the values at the cells are those of the owners. Points with the same weights on the same points of the mesh are one point, of neighbouring cells and of the outer surface: a cut region is one closed surface, every edge of two triangles.
- **A point on the plane belongs to the hidden half.** A plane through points of the mesh then cuts the cells on the visible side at their faces, with the values of the visible cells; a plane outside of the model hides nothing or everything.
- **The edges of the cut face** are the lines where the faces of the cut cells cross the plane: its outline and the cells in it.
- **2D models:** the cells are clipped at a line, and the line is an edge; there is no cut face. The app offers no *z* for them.
- **The ranges and the extremes** of a result stay those of the sections, of the whole outer surface and all points or cells, not of the visible part.
- **Caching:** the outer surface of a section is cached as before. The cut of a section is cached with its plane until the next cut or run (one per section), so a new substep, a quantity or a scale needs only the interpolation, a sparse product.
- **The meshes of the Model workspace** are cut by the requests that made them: `inspect-mesh`, `make-mesh` and `generate-mesh` take a `cut`. Python keeps the solid cells of the latest 16 meshes (`felupe_studio.meshes`), so a cut needs no new read of a file or run of a script; a new file of the project forgets them. A mesh file with a scale (#135) is cut at the coordinate divided by its scale.
  - **The latest cut only:** the app asks for a cut of a mesh once the one being made has arrived, so a slider moved by its keys asks for the cut where it stops, not for every step. A mesh is drawn with its latest cut until the next one arrives, and whole until the first one.
  - **The rest of the view is cut in the app** by the same plane: the markers in the hidden half are left out, those on the plane are drawn; the lines (of boundaries, loads, constraints and rigid surfaces) and the faces (of face sets, picked surfaces and rigid surfaces) are clipped at the plane, like the outer surface. The construction meshes of tools (ADR 0019) are clipped too, without a cut face: they are not part of the model.
  - **Picking:** a pick of a cut mesh is a pick of the triangle of its outer surface (`sources`), so the faces of the sections, the point sets and the face sets are those of the whole model. A click onto the cut face picks nothing.
  - **The cut of the view** is shared by the workspaces and forgotten for another project; a 2D model has no cut by z.
- **The results** are cut by the request `result` of every substep, with the cut in the key of the kept scenes (#141): a substep, a quantity or a scale of the same cut is a sparse product in Python, and a scene of a cut seen before is drawn at once. A scene arrives with its `cut`, so the app draws what is over it by the plane of that cut: a loaded scene of the cut before, until the new one arrives, and a live scene.
  - **The ghost of *Undeformed*** is the same cut surface at its positions without the displacement, so it is cut too.
  - **The values on the cut face** are those of the cut (the contour and the hover); a point of the cut face is named so, as it is no node unless the plane goes through one (`outer` of a surface: the triangles of the clipped outer surface, those of the cut face follow).
  - **The extremes:** an extreme at a node in the hidden half is not drawn. A cell gets the outlines of its drawn faces, also of its cut, which shows a cell inside that the plane crosses; a cell without drawn faces gets a dot at its center, unless it is in the hidden half.
  - **The constraints, the control points and the rigid surfaces** are cut in the undeformed model, like the cells: a control point in the hidden half is not drawn, the lines of a constraint are clipped at the plane and moved by the displacements of their ends, interpolated linearly like the cut face, and a rigid surface is clipped where it was before it moved, at the plane moved like it. They take their points from the nodes of the whole outer surface of a section (`uncut` of a cut surface): a point set by the bounds of the model or a rigid surface sized by them would change with the visible part.
  - **The live scenes of a run** (#207) are cut by the cut of the start of the run, like they keep its quantity: the worker runs the jobs and takes no new requests until they end. A changed cut applies after the run, and the status of the live results says so.
- **Vectorized** with NumPy and SciPy, without loops over the cells, only over the faces of a cell type and the lengths of the rows of the interpolation. On the largest model of the benchmarks, a cube of 8000 hexahedrons, a cut takes 15 to 22 ms in CPython and about 33 ms in Pyodide, the interpolation of a substep less than a millisecond ([Benchmarks](../benchmarks.md#a-cut-through-the-model-395)).
- **The implementation comes in three PRs:**
  1. this record and the geometry in Python, with `scene.surface()`, `results.scene()` and the request `result`;
  2. the Model workspace: *Cut* in the view toolbar, the cut meshes, the markers and symbols in the hidden half, picking on the outer faces only;
  3. the Results workspace: every substep, scale and the ghost of *Undeformed*, the values on the cut face, the extremes in the hidden half, the e2e test and the guide.

## Consequences

- **The viewer and its uses stay unchanged:** a cut is a surface, so the colors by sections and cell sets, the hover, the extremes and the picture of the view work with it as before.
- **A new cut is a request to Python:** the slider asks for a new cut when it stops. In the Model workspace, every mesh is cut on its own, of its kept cells.
- **Two clips of the same plane:** the meshes are clipped in Python, the markers, lines and faces over them in the app. Both clip the same triangles linearly at the plane, so a face set is drawn on its clipped faces.
- **More triangles at the cut:** the cut face has about 18 triangles per cut hexahedron, 4 per tetrahedron and 54 per quadratic hexahedron, the sections of their tetrahedrons, not one polygon per cell. That is simple and the same for every cell type; at a cut of the largest benchmark, it is about one and a half times the triangles of its outer surface.
- **The triangles of the cut face are no faces of the model:** picking, point sets and face sets skip them (`sources`).
- **A cut scene of the results is a little larger:** it carries the nodes of the whole outer surface with their displacements (`uncut`), 24 bytes per node, for the constraints and the rigid surfaces over it.
- **Private helpers of FElupe:** `felupe.view._surface` (`_template`, `_element`, `FACES` and `CORNERS`), next to `triangulate_surface`, which the app already takes from it. The tests of the cut (a closed surface of every cell type, the area of the cut face) catch a change in a new version of FElupe.

## Alternatives

- **A clipping plane of the viewer (WebGL):** it hides the half, but there is no cut face, only the inside of the outer surface, and the viewer has no values inside the cells. It changes the vendored viewer (ADR 0004).
- **In the app (TypeScript):** the app has the outer surfaces, not the cells or the shape functions of quadratic cells; a second copy of the surface of FElupe.
- **A cut through the deformed model:** the cut face would show other material points in every substep and at every scale, and the cut would be made again for each of them.
- **A decomposition of the cells into tetrahedrons without the center** (five or six per hexahedron): fewer triangles, but its diagonals of the faces are not those of the outer surface (gaps), and quadratic cells are not subdivided.
- **Quadratic cells cut through their corner points:** simpler, but the straight cut face does not meet the curved clipped outer surface.
- **Tables of the cases per cell type** (like marching cubes): many cases per cell type, and none for subdivided faces.
- **A request of its own to cut a mesh,** with an id of the kept mesh: a second way to name a mesh beside the requests that make it, and an id that the app loses with a new worker. The request that made a mesh names it, and makes it again if Python does not keep it.
- **The symbols of the hidden half hidden by their points,** not clipped: a line or an arrow from a point in the visible half would reach beyond the plane, over the cut face.
- **The overlays of the results clipped at the plane in the deformed model:** they would not meet the cut face, which moves with the material, and a rigid surface would appear or vanish as it moves.
- **The live scenes without a cut,** or with the cut of the view at every scene: the worker cannot take a new cut while it runs the jobs, and scenes without the cut of the view would change the picture at the end of the run.
