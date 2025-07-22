import { UploadItem } from "./services";
import * as THREE from "three";

const uploadModal = document.getElementById("upload-modal");
const uploadContainer = document.getElementById('upload-container');
const uploadInput = document.getElementById('upload-input');
const uploadText = document.getElementById('upload-text');
const uploadPreview = document.getElementById('upload-preview');
const uploadTitle = document.getElementById("upload-title");
const uploadEnDes = document.getElementById("upload-english-description");
const uploadVietDes = document.getElementById("upload-vietnamese-description");
const uploadSpinner = document.getElementById("upload-spinner");
const uploadSubmit = document.getElementById("upload-btn");
// const toastAlert = document.getElementById("toast-alert");
const FirstIMGCol = document.getElementById('FirstIMGCol');
const TitleContainer = document.getElementById('TitleContainer');
const BottomContainer = document.getElementById('BottomContainer');
const CancelBtnContainer = document.getElementById('CancelBtnContainer');
const ImageShowContainer = document.getElementById('ImageShowContainer'); // Get the main container



// toastAlert.style.display = "none";
let file = null;
let uploadProperties = {
    roomID: 0,
    asset_mesh_name: null
};

export function toastMessage(message) {
    toastAlert.style.display = "flex";
    toastAlert.textContent = message;
    setTimeout(() => { toastAlert.style.display = "none" }, 3000);
}

export function closeUploadModal() {
    uploadModal.style.display = "none";
    uploadPreview.src = '';
    uploadPreview.style.display = 'none';
    uploadText.style.display = 'flex';
    uploadInput.value = null;
    uploadTitle.value = "";
    uploadEnDes.value = "";
    uploadVietDes.value = "";
}

export function displayUploadModal(_aspectRatio, uploadProps) {
    uploadModal.style.display = "block";
    uploadProperties = uploadProps;
    console.log("upload properties: ", uploadProps);
}

export function initUploadModal() {
    console.log("init");
    const closeBtn = document.getElementById("upload-close");
    closeBtn.addEventListener("click", closeUploadModal);

    const openInput = () =>{
        uploadInput.click();
    } 

    const fileChange = (event) => {
        file = event.target.files[0];
        handleFile(file);
    };

    const submitCallback = () => {
        if (!file) return toastMessage("Select an image.");

        uploadSpinner.style.display = 'block';
        uploadSubmit.disabled = true;

        const { roomID , asset_mesh_name } = uploadProperties;

        UploadItem(file, asset_mesh_name , uploadTitle.value, uploadVietDes.value, uploadEnDes.value, roomID)
            .then((res) => {
                uploadSpinner.style.display = 'none';
                uploadSubmit.disabled = false;
                const uploadEvent = new CustomEvent("uploadevent", {
                    detail: {
                        ...uploadProperties,
                        title: uploadTitle.value,
                        vietnamese_description: uploadVietDes.value,
                        english_description: uploadEnDes.value,
                        img_url: URL.createObjectURL(file)
                    }
                });

                document.body.dispatchEvent(uploadEvent);

                if (res.success) closeUploadModal();
            })
            .catch((error) => {
                console.log("error 2: ", error);
                toastMessage(error.message || error.toString());
                uploadSpinner.style.display = 'none';
                uploadSubmit.disabled = false;
            });
    };

    uploadContainer.addEventListener('click', openInput);
    uploadInput.addEventListener('change', fileChange);
    uploadSubmit.addEventListener("click", submitCallback);

    uploadContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadContainer.classList.add('dragover');
    });
    uploadContainer.addEventListener('dragleave', () => {
        uploadContainer.classList.remove('dragover');
    });
    uploadContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadContainer.classList.remove('dragover');
        file = e.dataTransfer.files[0];
        handleFile(file);
    });

    uploadModal.style.display = "none";

}


function handleFile(file) {
    if (file && (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webP')) {
        const reader = new FileReader();
        reader.onload = function (e) {
            uploadPreview.src = e.target.result;
            uploadPreview.style.display = 'block';
            uploadText.style.display = 'none';
        };
        reader.readAsDataURL(file);
    } else {
        alert('Please upload a PNG or JPG image.');
    }
}

export function Mapping_PictureFrame_ImageMesh(FrameToImageMeshMap , pictureFramesArray, imageMeshesArray){
    let imageMeshes = imageMeshesArray; // GET ALL THE ImageMesh from the annotationMesh map
    console.log("ImageMesh Array: ", imageMeshesArray)
    console.log("PictureFrame Array: ", pictureFramesArray)
    for (const frame of pictureFramesArray){
        let closest = null;
        let minDistance = Infinity;

        const framePosition = new THREE.Vector3();
        frame.getWorldPosition(framePosition);

        for (const imgMesh of imageMeshes){
            const imgPosition = new THREE.Vector3();
            imgMesh.getWorldPosition(imgPosition)

            const distance = framePosition.distanceTo(imgPosition);
            if(distance < minDistance){
                closest = imgMesh;
                minDistance = distance;
            }
        }

        if(closest){
            FrameToImageMeshMap[frame.name] = closest.name;
        }
    }
}

export function DisplayImageOnDiv(imageURL, title, vietnamese_description, english_description) {
    if (!FirstIMGCol || !TitleContainer || !BottomContainer || !ImageShowContainer) {
        console.error("Missing target DOM elements. Check your HTML structure.");
        return;
    }

    const language = localStorage.getItem('language');
    const description = language === 'vi' ? vietnamese_description : english_description;

    // Clear previous content
    FirstIMGCol.innerHTML = '';
    TitleContainer.innerHTML = '';
    BottomContainer.innerHTML = '';

    // Create image element
    const imgElement = document.createElement('img');
    imgElement.src = imageURL;
    imgElement.alt = title || 'Artwork';
    imgElement.style.width = '100%';
    imgElement.style.height = '100%';
    imgElement.style.objectFit = 'contain';
    FirstIMGCol.appendChild(imgElement);

    // Insert title
    TitleContainer.innerHTML = `
        <div class="Title text-xl font-semibold w-full text-center my-2">${title}</div>
    `;

    // Insert description
    BottomContainer.innerHTML = `
        <div class="Description text-md font-normal w-full px-5">${description}</div>
    `;

    // Show container
    ImageShowContainer.style.display = "flex";
    // Make sure event listener only binds once
    CancelBtnContainer.onclick = () => {
        ImageShowContainer.style.display = 'none';
    };
}


