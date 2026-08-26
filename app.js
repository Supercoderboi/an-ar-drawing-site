import * as THREE from 'three';

const $ = (id) => document.getElementById(id);

const canvas = $('scene');
const viewport = $('viewport');
const status = $('status');
const hint = $('hint');
const emptyState = $('emptyState');
const imageInput = $('imageInput');


// ============================================================
// THREE.JS
// ============================================================

const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true
});

renderer.setPixelRatio(
  Math.min(window.devicePixelRatio, 2)
);

renderer.setSize(
  viewport.clientWidth,
  viewport.clientHeight,
  false
);

renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  55,
  1,
  0.01,
  100
);


// ============================================================
// DESKTOP PREVIEW
// ============================================================

const desktopGroup = new THREE.Group();

scene.add(desktopGroup);

const desktopGrid = new THREE.GridHelper(
  10,
  20,
  0x35545a,
  0x1b2e33
);

desktopGrid.position.y = -0.7;

desktopGroup.add(
  desktopGrid
);

const desktopCamera = new THREE.PerspectiveCamera(
  45,
  1,
  0.1,
  100
);

desktopCamera.position.set(
  0,
  2.5,
  4.2
);

desktopCamera.lookAt(
  0,
  0,
  0
);


// ============================================================
// STATE
// ============================================================

let texture = null;

let imageMesh = null;
let previewMesh = null;

let xrSession = null;

let hitSource = null;
let viewerSpace = null;
let referenceSpace = null;

let currentHit = null;

let xrAnchor = null;

let placed = false;


// Image settings
let sizeFactor = 1;
let angle = 0;
let opacity = 1;


// Touch state
let lastPointers = new Map();

let lastPinch = 0;
let lastAngle = 0;


// ============================================================
// LOCKED WORLD TRANSFORM
// ============================================================

/*
 * Once the image is placed, these values describe
 * its original world position and surface orientation.
 *
 * They are NOT changed by the live hit-test.
 */

const lockedPosition =
  new THREE.Vector3();

const lockedSurfaceQuaternion =
  new THREE.Quaternion();

let hasLockedTransform = false;


// ============================================================
// UI
// ============================================================

function setStatus(
  value,
  tone = ''
) {

  status.textContent = value;

  status.className =
    `status ${tone}`;
}


// ============================================================
// CREATE IMAGE MESH
// ============================================================

function makeMesh(preview = false) {

  if (!texture) {
    return null;
  }


  const aspect =
    texture.image.width /
    texture.image.height;


  const width = 0.9;

  const height =
    width / aspect;


  const geometry =
    new THREE.PlaneGeometry(
      width,
      height
    );


  const material =
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: !preview
    });


  const mesh =
    new THREE.Mesh(
      geometry,
      material
    );


  /*
   * IMPORTANT:
   *
   * We don't rotate the mesh here.
   *
   * The AR surface orientation is applied when
   * the image is placed.
   */


  if (preview) {

    material.opacity =
      Math.min(
        opacity,
        0.55
      );
  }


  return mesh;
}


// ============================================================
// CREATE / RECREATE MESHES
// ============================================================

function rebuildMesh() {

  /*
   * This function is only used when a completely
   * new image is loaded.
   *
   * We DO NOT use it for normal size/rotation changes
   * because that would destroy the world transform.
   */


  if (imageMesh) {

    scene.remove(
      imageMesh
    );

    imageMesh.geometry.dispose();
    imageMesh.material.dispose();

    imageMesh = null;
  }


  imageMesh =
    makeMesh(false);


  if (imageMesh) {

    imageMesh.visible =
      placed;

    scene.add(
      imageMesh
    );
  }


  if (previewMesh) {

    scene.remove(
      previewMesh
    );

    previewMesh.geometry.dispose();
    previewMesh.material.dispose();

    previewMesh = null;
  }


  previewMesh =
    makeMesh(true);


  if (previewMesh) {

    previewMesh.visible =
      !placed;

    scene.add(
      previewMesh
    );
  }


  updateMeshAppearance();
}


// ============================================================
// UPDATE SCALE / OPACITY
// ============================================================

function updateMeshAppearance() {

  if (imageMesh) {

    /*
     * Scale the existing mesh instead of rebuilding it.
     *
     * This preserves its world position.
     */

    imageMesh.scale.set(
      sizeFactor,
      sizeFactor,
      sizeFactor
    );

    imageMesh.material.opacity =
      opacity;
  }


  if (previewMesh) {

    previewMesh.scale.set(
      sizeFactor,
      sizeFactor,
      sizeFactor
    );

    previewMesh.material.opacity =
      Math.min(
        opacity,
        0.55
      );
  }
}


// ============================================================
// APPLY LOCKED AR TRANSFORM
// ============================================================

function applyLockedTransform(
  mesh,
  position,
  surfaceQuaternion
) {

  if (!mesh) {
    return;
  }


  /*
   * PlaneGeometry is an XY plane.
   *
   * Rotate its normal from +Z to +Y so that
   * the image lies flat on a horizontal surface.
   */

  const planeRotation =
    new THREE.Quaternion()
      .setFromEuler(
        new THREE.Euler(
          -Math.PI / 2,
          0,
          0,
          'XYZ'
        )
      );


  /*
   * User rotation around the surface normal.
   */

  const userRotation =
    new THREE.Quaternion()
      .setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        angle
      );


  /*
   * Start with the detected surface orientation.
   */

  const finalQuaternion =
    surfaceQuaternion.clone();


  /*
   * Apply the plane orientation.
   */

  finalQuaternion.multiply(
    planeRotation
  );


  /*
   * Apply the user's rotation.
   *
   * Because the image is already lying on the
   * surface, this rotates it around that surface.
   */

  finalQuaternion.multiply(
    userRotation
  );


  /*
   * Calculate a small offset along the surface normal.
   *
   * This is better than simply doing:
   *
   * position.y += 0.006
   *
   * because the surface may not be perfectly horizontal.
   */

  const normal =
    new THREE.Vector3(
      0,
      1,
      0
    );

  normal.applyQuaternion(
    surfaceQuaternion
  );

  const finalPosition =
    position.clone();

  finalPosition.add(
    normal.multiplyScalar(0.006)
  );


  mesh.position.copy(
    finalPosition
  );

  mesh.quaternion.copy(
    finalQuaternion
  );

  mesh.scale.set(
    sizeFactor,
    sizeFactor,
    sizeFactor
  );


  mesh.matrixAutoUpdate =
    true;

  mesh.updateMatrix();
}


// ============================================================
// UPDATE PLACED IMAGE FROM ANCHOR
// ============================================================

function updateAnchoredImage(
  frame
) {

  /*
   * THIS IS THE IMPORTANT PART.
   *
   * Once placed, we NEVER ask the live hit-test
   * where the floor is.
   *
   * We only use the AR anchor.
   */

  if (
    !placed ||
    !imageMesh ||
    !xrAnchor ||
    !referenceSpace
  ) {

    return;
  }


  const pose =
    frame.getPose(
      xrAnchor.anchorSpace,
      referenceSpace
    );


  if (!pose) {
    return;
  }


  const anchorMatrix =
    new THREE.Matrix4()
      .fromArray(
        pose.transform.matrix
      );


  const position =
    new THREE.Vector3();

  const quaternion =
    new THREE.Quaternion();

  const scale =
    new THREE.Vector3();


  anchorMatrix.decompose(
    position,
    quaternion,
    scale
  );


  /*
   * The anchor itself is now our source of truth.
   */

  applyLockedTransform(
    imageMesh,
    position,
    quaternion
  );
}


// ============================================================
// UPDATE LOCKED IMAGE WITHOUT ANCHOR
// ============================================================

function updateUnanchoredImage() {

  /*
   * If anchors aren't supported, use the original
   * placement transform forever.
   *
   * This is still much better than following the
   * live hit-test.
   */

  if (
    !placed ||
    xrAnchor ||
    !hasLockedTransform ||
    !imageMesh
  ) {

    return;
  }


  applyLockedTransform(
    imageMesh,
    lockedPosition,
    lockedSurfaceQuaternion
  );
}


// ============================================================
// LOAD IMAGE
// ============================================================

function setImage(file) {

  const url =
    URL.createObjectURL(
      file
    );


  const loader =
    new THREE.TextureLoader();


  loader.load(
    url,
    (loaded) => {

      if (texture) {
        texture.dispose();
      }


      texture = loaded;

      texture.colorSpace =
        THREE.SRGBColorSpace;


      sizeFactor = 1;
      angle = 0;
      opacity = 1;

      placed = false;

      hasLockedTransform =
        false;


      lockedPosition.set(
        0,
        0,
        0
      );

      lockedSurfaceQuaternion.identity();


      if (xrAnchor) {

        xrAnchor.delete?.();

        xrAnchor = null;
      }


      rebuildMesh();


      emptyState
        .classList
        .add('hidden');


      $('place')
        .classList
        .remove('hidden');


      hint.textContent =
        'Point at the floor and tap to place your pookalam.';


      setStatus(
        'Image ready'
      );


      URL.revokeObjectURL(
        url
      );
    }
  );
}


// ============================================================
// RESIZE
// ============================================================

function resize() {

  const width =
    viewport.clientWidth;

  const height =
    viewport.clientHeight;


  renderer.setSize(
    width,
    height,
    false
  );


  camera.aspect =
    width / height;

  camera.updateProjectionMatrix();
}


window.addEventListener(
  'resize',
  resize
);

resize();


// ============================================================
// START AR
// ============================================================

async function startAR() {

  if (!navigator.xr) {

    $('unsupported')
      .classList
      .remove('hidden');

    setStatus(
      'AR unavailable'
    );

    return;
  }


  if (!texture) {

    hint.textContent =
      'Choose your pookalam image first.';

    return;
  }


  try {

    xrSession =
      await navigator.xr.requestSession(
        'immersive-ar',
        {
          requiredFeatures: [
            'local',
            'hit-test'
          ],

          optionalFeatures: [
            'anchors',
            'plane-detection',
            'light-estimation',
            'dom-overlay'
          ],

          domOverlay: {
            root: document.body
          }
        }
      );


    /*
     * Let Three.js handle the XR camera.
     */

    renderer.xr.setReferenceSpaceType(
      'local'
    );


    await renderer.xr.setSession(
      xrSession
    );


    referenceSpace =
      await xrSession.requestReferenceSpace(
        'local'
      );


    viewerSpace =
      await xrSession.requestReferenceSpace(
        'viewer'
      );


    hitSource =
      await xrSession.requestHitTestSource({
        space: viewerSpace
      });


    xrSession.addEventListener(
      'end',
      () => {

        xrSession = null;

        hitSource = null;
        viewerSpace = null;
        referenceSpace = null;

        currentHit = null;


        if (xrAnchor) {

          xrAnchor.delete?.();

          xrAnchor = null;
        }


        /*
         * Don't destroy the placed image here.
         * The next AR session can reuse it.
         */

        setStatus(
          'AR ended'
        );


        $('startAr')
          .classList
          .remove('hidden');


        $('exitAr')
          .classList
          .add('hidden');
      }
    );


    $('startAr')
      .classList
      .add('hidden');


    $('exitAr')
      .classList
      .remove('hidden');


    setStatus(
      'Scan a surface'
    );


    hint.textContent =
      'Move slowly over the floor until the surface is detected.';

  } catch (error) {

    console.error(
      'AR start error:',
      error
    );


    setStatus(
      'AR could not start'
    );


    hint.textContent =
      error.message ||
      'Use Chrome on a supported Android phone over HTTPS.';
  }
}


// ============================================================
// PLACE IMAGE
// ============================================================

function placeImage() {

  /*
   * We need a current hit to know the initial
   * location.
   */

  if (
    !currentHit ||
    !referenceSpace ||
    !imageMesh
  ) {

    hint.textContent =
      'Point at the floor until a surface is detected.';

    return;
  }


  const pose =
    currentHit.getPose(
      referenceSpace
    );


  if (!pose) {
    return;
  }


  /*
   * THIS IS THE ONLY TIME WE USE THE
   * LIVE HIT-TEST TO POSITION THE IMAGE.
   */

  const hitMatrix =
    new THREE.Matrix4()
      .fromArray(
        pose.transform.matrix
      );


  const position =
    new THREE.Vector3();

  const quaternion =
    new THREE.Quaternion();

  const scale =
    new THREE.Vector3();


  hitMatrix.decompose(
    position,
    quaternion,
    scale
  );


  /*
   * Save the initial world transform.
   */

  lockedPosition.copy(
    position
  );

  lockedSurfaceQuaternion.copy(
    quaternion
  );

  hasLockedTransform =
    true;


  placed = true;


  /*
   * Remove any previous anchor.
   */

  if (xrAnchor) {

    xrAnchor.delete?.();

    xrAnchor = null;
  }


  /*
   * Apply the image immediately.
   */

  applyLockedTransform(
    imageMesh,
    lockedPosition,
    lockedSurfaceQuaternion
  );


  imageMesh.visible =
    true;


  if (previewMesh) {

    previewMesh.visible =
      false;
  }


  /*
   * Create an AR anchor.
   *
   * If the browser supports anchors, this becomes
   * the long-term reference for the pookalam.
   */

  if (
    currentHit.createAnchor
  ) {

    currentHit
      .createAnchor()
      .then(
        (anchor) => {

          xrAnchor =
            anchor;

          console.log(
            'AR anchor created'
          );
        }
      )
      .catch(
        (error) => {

          /*
           * That's okay.
           *
           * We already have the locked transform
           * as a fallback.
           */

          console.warn(
            'AR anchor unavailable:',
            error
          );

          xrAnchor =
            null;
        }
      );
  }


  setStatus(
    'Pookalam placed',
    'ready'
  );


  hint.textContent =
    'Move around freely. The pookalam is locked to the floor.';
}


// ============================================================
// DELETE IMAGE
// ============================================================

function deleteImage() {

  if (xrAnchor) {

    xrAnchor.delete?.();

    xrAnchor = null;
  }


  placed = false;

  hasLockedTransform =
    false;


  if (imageMesh) {

    imageMesh.visible =
      false;
  }


  if (previewMesh) {

    previewMesh.visible =
      true;
  }


  setStatus(
    texture
      ? 'Image ready'
      : 'Ready'
  );


  hint.textContent =
    texture
      ? 'Point at the floor and tap to place.'
      : 'Choose an image to begin.';
}


// ============================================================
// XR RENDER LOOP
// ============================================================

renderer.setAnimationLoop(
  (time, frame) => {

    if (
      frame &&
      xrSession &&
      hitSource &&
      referenceSpace
    ) {

      /*
       * --------------------------------------------------------
       * LIVE HIT TEST
       * --------------------------------------------------------
       *
       * ONLY used while the image has NOT been placed.
       */

      if (!placed) {

        const hits =
          frame.getHitTestResults(
            hitSource
          );


        currentHit =
          hits[0] || null;


        if (
          currentHit &&
          previewMesh
        ) {

          const pose =
            currentHit.getPose(
              referenceSpace
            );


          if (pose) {

            /*
             * Preview follows the floor.
             * This is allowed because it hasn't
             * been placed yet.
             */

            const matrix =
              new THREE.Matrix4()
                .fromArray(
                  pose.transform.matrix
                );


            const position =
              new THREE.Vector3();

            const quaternion =
              new THREE.Quaternion();

            const scale =
              new THREE.Vector3();


            matrix.decompose(
              position,
              quaternion,
              scale
            );


            applyLockedTransform(
              previewMesh,
              position,
              quaternion
            );
          }


          setStatus(
            'Surface detected',
            'ready'
          );
        }

      } else {

        /*
         * ------------------------------------------------------
         * IMAGE IS ALREADY PLACED
         * ------------------------------------------------------
         *
         * DO NOT READ THE LIVE HIT-TEST.
         *
         * The image is now controlled exclusively by
         * the AR anchor or its original locked transform.
         */

        if (xrAnchor) {

          updateAnchoredImage(
            frame
          );

        } else {

          updateUnanchoredImage();
        }
      }
    }


    /*
     * IMPORTANT:
     *
     * Do not manually use renderer.xr.getCamera().
     */

    if (xrSession) {

      renderer.render(
        scene,
        camera
      );

    } else {

      renderer.render(
        scene,
        desktopCamera
      );
    }
  }
);


// ============================================================
// FILE PICKER
// ============================================================

imageInput.addEventListener(
  'change',
  () => {

    if (
      imageInput.files[0]
    ) {

      setImage(
        imageInput.files[0]
      );
    }
  }
);


// ============================================================
// BUTTONS
// ============================================================

$('choose')
  .addEventListener(
    'click',
    () => {

      imageInput.click();
    }
  );


$('startAr')
  .addEventListener(
    'click',
    startAR
  );


$('exitAr')
  .addEventListener(
    'click',
    () => {

      xrSession?.end();
    }
  );


$('place')
  .addEventListener(
    'click',
    placeImage
  );


$('delete')
  .addEventListener(
    'click',
    deleteImage
  );


// ============================================================
// OPACITY
// ============================================================

$('opacity')
  .addEventListener(
    'input',
    (e) => {

      opacity =
        Number(
          e.target.value
        ) / 100;


      $('opacityValue').value =
        `${e.target.value}%`;


      if (imageMesh) {

        imageMesh.material.opacity =
          opacity;
      }


      if (previewMesh) {

        previewMesh.material.opacity =
          Math.min(
            opacity,
            0.55
          );
      }
    }
  );


// ============================================================
// SIZE
// ============================================================

$('size')
  .addEventListener(
    'input',
    (e) => {

      sizeFactor =
        Number(
          e.target.value
        ) / 100;


      $('sizeValue').value =
        `${sizeFactor.toFixed(1)}x`;


      /*
       * IMPORTANT:
       *
       * We modify the existing mesh.
       * We do NOT rebuild it.
       *
       * Therefore its world position stays locked.
       */

      updateMeshAppearance();


      /*
       * If currently placed, immediately reapply
       * the locked transform with the new scale.
       */

      if (placed) {

        if (xrAnchor) {

          /*
           * The next XR frame will update it.
           */

        } else {

          updateUnanchoredImage();
        }
      }
    }
  );


// ============================================================
// ROTATE LEFT
// ============================================================

$('rotateLeft')
  .addEventListener(
    'click',
    () => {

      angle -=
        Math.PI / 12;


      if (placed) {

        if (xrAnchor) {

          /*
           * Anchor position stays the same.
           * Only orientation changes.
           *
           * It will be applied on the next XR frame.
           */

        } else {

          updateUnanchoredImage();
        }

      } else {

        /*
         * Preview will pick up the new angle
         * on its next update.
         */

        updateMeshAppearance();
      }
    }
  );


// ============================================================
// ROTATE RIGHT
// ============================================================

$('rotateRight')
  .addEventListener(
    'click',
    () => {

      angle +=
        Math.PI / 12;


      if (placed) {

        if (xrAnchor) {

          /*
           * Applied on the next XR frame.
           */

        } else {

          updateUnanchoredImage();
        }

      } else {

        updateMeshAppearance();
      }
    }
  );


// ============================================================
// TOUCH / TAP
// ============================================================

canvas.addEventListener(
  'pointerdown',
  (e) => {

    /*
     * --------------------------------------------------------
     * SINGLE TAP TO PLACE
     * --------------------------------------------------------
     *
     * Only place if:
     *
     * - we're in AR
     * - image isn't already placed
     * - a surface has been detected
     */

    if (
      lastPointers.size === 0 &&
      !placed &&
      xrSession &&
      currentHit
    ) {

      placeImage();

      return;
    }


    /*
     * --------------------------------------------------------
     * MULTI-TOUCH
     * --------------------------------------------------------
     */

    canvas.setPointerCapture(
      e.pointerId
    );


    lastPointers.set(
      e.pointerId,
      {
        x: e.clientX,
        y: e.clientY
      }
    );


    if (
      lastPointers.size === 2
    ) {

      const p =
        [
          ...lastPointers.values()
        ];


      lastPinch =
        Math.hypot(
          p[0].x -
            p[1].x,

          p[0].y -
            p[1].y
        );


      lastAngle =
        Math.atan2(
          p[1].y -
            p[0].y,

          p[1].x -
            p[0].x
        );
    }
  }
);


// ============================================================
// TOUCH MOVE
// ============================================================

canvas.addEventListener(
  'pointermove',
  (e) => {

    if (
      !lastPointers.has(
        e.pointerId
      )
    ) {

      return;
    }


    lastPointers.set(
      e.pointerId,
      {
        x: e.clientX,
        y: e.clientY
      }
    );


    /*
     * Only manipulate the image AFTER it has
     * been placed.
     */

    if (
      lastPointers.size === 2 &&
      placed
    ) {

      const p =
        [
          ...lastPointers.values()
        ];


      // ------------------------------------------------------
      // PINCH
      // ------------------------------------------------------

      const pinch =
        Math.hypot(
          p[0].x -
            p[1].x,

          p[0].y -
            p[1].y
        );


      if (lastPinch > 0) {

        sizeFactor =
          Math.max(
            0.25,

            Math.min(
              3,

              sizeFactor *
                pinch /
                lastPinch
            )
          );
      }


      $('size').value =
        sizeFactor * 100;


      $('sizeValue').value =
        `${sizeFactor.toFixed(1)}x`;


      // ------------------------------------------------------
      // ROTATION
      // ------------------------------------------------------

      const currentAngle =
        Math.atan2(
          p[1].y -
            p[0].y,

          p[1].x -
            p[0].x
        );


      angle +=
        currentAngle -
        lastAngle;


      /*
       * Don't rebuild the mesh.
       *
       * Just update its appearance and transform.
       */

      updateMeshAppearance();


      if (xrAnchor) {

        /*
         * Anchor position is unchanged.
         * Orientation will be updated by the XR loop.
         */

      } else {

        updateUnanchoredImage();
      }


      lastPinch =
        pinch;

      lastAngle =
        currentAngle;
    }
  }
);


// ============================================================
// TOUCH END
// ============================================================

[
  'pointerup',
  'pointercancel'
].forEach(
  (event) => {

    canvas.addEventListener(
      event,
      (e) => {

        lastPointers.delete(
          e.pointerId
        );


        /*
         * Reset gesture state when fingers are removed.
         */

        if (
          lastPointers.size < 2
        ) {

          lastPinch = 0;
          lastAngle = 0;
        }
      }
    );
  }
);
