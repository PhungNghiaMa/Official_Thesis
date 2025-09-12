// raycaster.js
import * as THREE from 'three';
import { acceleratedRaycast } from "three-mesh-bvh";
if (acceleratedRaycast) THREE.Mesh.prototype.raycast = acceleratedRaycast;
export default class RaycasterManager {
  constructor(camera, scene, domElement, options = {}) {
    this.camera = camera;
    this.scene = scene;
    this.domElement = domElement;
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();

    this.doorNames = options.doorNames || ["Door001"];
    this.doorClickCallback = options.onDoorClick;
    this.outlineCallback = options.onHoverPictureFrame;
    this.pictureClickCallback = options.onClickPictureFrame;
    this.onNPCPathFollow = options.onNPCPathFollow;
    this.onGroundClick = options.onGroundClick;


    this.pictureFrames = [];
    this.outlinePass = null;
    this.lastHovered = null;
    this.enabled = true;

    domElement.addEventListener('click', this.handleClick.bind(this));
    domElement.addEventListener('mousemove', this.handleMouseMove.bind(this));
  }

  setPictureFrames(PictureFrameMeshList) {
    this.pictureFrames = PictureFrameMeshList;
  }

  setPictureClickCallback(callback){
    this.pictureClickCallback = callback;
  }

  setOutlinePass(outlinePass){
    this.outlinePass = outlinePass
  }

//   handleClick(event) {
//     if (!this.enabled) return;

//     this.updatePointer(event);
//     this.raycaster.setFromCamera(this.pointer, this.camera);
//     const intersects = this.raycaster.intersectObjects(this.scene.children, true);
//     if (intersects.length === 0) return;

//     const clickedObject = intersects[0].object;
//     const name = clickedObject.name;
//     if (this.doorNames.includes(clickedObject.parent?.name) && this.doorClickCallback) {
//       this.doorClickCallback(clickedObject);
//     }

//     if (/^Picture_Frame\d+$/.test(name)) {
//         if (this.pictureClickCallback) {
//             this.pictureClickCallback(name);  // e.g., Picture_Frame024
//         }
//     }
// }

handleClick(event) {
  if (!this.enabled) return;

  this.updatePointer(event);
  this.raycaster.setFromCamera(this.pointer, this.camera);
  const intersects = this.raycaster.intersectObjects(this.scene.children, true);
  if (intersects.length === 0) return;

  // choose the first meaningful intersection
  const first = intersects[0];
  const clickedObject = first.object;
  const name = clickedObject.name;

  // door click (keep old behavior) -> return after handling
  if (this.doorNames.includes(clickedObject.parent?.name) && this.doorClickCallback) {
    this.doorClickCallback(clickedObject);
    return;
  }

  // picture frame click -> return after handling
  if (/^Picture_Frame\d+$/.test(name)) {
    if (this.pictureClickCallback) {
      this.pictureClickCallback(name);
    }
    return;
  }

  // general object click callback (e.g. for navigation) — pass the intersection
  if (this.onNPCPathFollow) {
    // pass the intersection object (has .point, .object, etc)
    this.onNPCPathFollow(first);
  }
  
  // ground click callback for crowd agent movement
  if (this.onGroundClick) {
    this.onGroundClick(first);
  }
}


handleMouseMove(event) {
  if (!this.enabled) return;

  this.updatePointer(event);
  this.raycaster.setFromCamera(this.pointer, this.camera);

  const intersects = this.raycaster.intersectObjects(this.pictureFrames, true);
  if (intersects.length > 0) {
    const hovered = intersects[0].object;
    if (hovered !== this.lastHovered) {
      this.lastHovered = hovered;
      if (this.outlinePass) this.outlinePass.selectedObjects = [hovered];
    }
  } else if (this.lastHovered) {
    this.lastHovered = null;
    if (this.outlinePass) this.outlinePass.selectedObjects = [];
  }
}

  updatePointer(event) {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

}