// raycaster.js
import * as THREE from 'three';
import { acceleratedRaycast } from "three-mesh-bvh";
// Enhance performance by using BVH (Bounding Volume Hierarchy) for faster raycasting
if (acceleratedRaycast) THREE.Mesh.prototype.raycast = acceleratedRaycast;
export default class RaycasterManager {
  constructor(camera, scene, domElement, options = {}) {
    this.camera = camera;
    this.scene = scene;
    this.domElement = domElement;
    this.pointer = new THREE.Vector2(); // Stores 2D mouse position
    this.raycaster = new THREE.Raycaster();

    // Internal state and callback assignments
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

    // Attach event listeners to the DOM
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


  handleClick(event) {
    if (!this.enabled) return;
    // 1. Convert mouse pixels to -1/+1 normalized coordinates
    this.updatePointer(event);

    // 2. Project a ray from the camera lens through the mouse pointer into the scene
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // 3. Find all objects in the scene that the ray passes through
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);
    if (intersects.length === 0){
      console.warn("INTERSECTS NOT EXIST !")
      return;
    } 
    window.INTERSECTS = intersects;

    // Extract the first (closest) intersection data
    const first = intersects[0];
    const clickedObject = first.object;
    const name = clickedObject.name;

    window.CLICK_PICTURE = name

    // Logic for Door Interaction
    if (this.doorNames.includes(clickedObject.parent?.name) && this.doorClickCallback) {
      this.doorClickCallback(clickedObject);
      return;
    }

    // picture frame click -> return after handling
    if (/^(PictureFrame)(\d{3})$/.test(name) || /^(ImageMesh)(\d{3})$/.test(name)) {
      if (this.pictureClickCallback) {
        this.pictureClickCallback(name);
      }else{
        console.warn("PICTURE CLICK CALLBACK NOT EXIST !")
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

  dispose() {
    this.domElement.removeEventListener('click', this._handleClick);
    this.domElement.removeEventListener('mousemove', this._handleMouseMove);
    this.pictureFrames = [];
    this.interactables = [];
  }
}