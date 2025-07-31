// gallery_logic.js
import galleryTemplate from '../template/gallery_template.js';
import navigationPage from '../template/navigation_page_template.js';

let currentRoom = 0;
let currentPage = 1;
const itemsPerPage = 20;
let assetData = [];

const BACKEND_URL =
  import.meta.env.MODE === "production"
    ? import.meta.env.VITE_PROD_BACKEND_URL // Use VITE_ prefix
    : import.meta.env.VITE_BACKEND_URL;     // Use VITE_ prefix
console.log("BACKEND URL: ", BACKEND_URL)
export function initGalleryPage(container) {
  container.innerHTML = navigationPage;
  const bottomContainer = container.querySelector(".BottomFunctionContainer");
  bottomContainer.innerHTML = galleryTemplate;

  bindRoomButtons();
  bindFilterCheckboxes();
  fetchAssetData(currentRoom);

  // Re-attach language switcher logic and update translations
  if (window.changeLanguage && typeof window.changeLanguage === 'function') {
    const vietBtn = container.querySelector('.VietBtn');
    const enBtn = container.querySelector('.EnBtn');
    let currentLanguage = localStorage.getItem('language') || 'vi';
    if (enBtn && vietBtn) {
      enBtn.addEventListener('click', () => {
        if(currentLanguage === 'en'){
          vietBtn.innerHTML = 'VI';
          enBtn.innerHTML = 'EN';
          currentLanguage = 'vi';
          localStorage.setItem('language', 'vi');
          window.changeLanguage('vi');
        }else if (currentLanguage === 'vi'){
          vietBtn.innerHTML = 'EN';
          enBtn.innerHTML = 'VI';
          currentLanguage = 'en';
          localStorage.setItem('language', 'en');
          window.changeLanguage('en');
        }
      });
    }
    // Update translations for the new DOM
    if (window.updateContent && typeof window.updateContent === 'function') {
      window.updateContent();
    }
  }

  const returnBtn = container.querySelector('.houseBtn');
  if (returnBtn) {
    returnBtn.addEventListener('click', () => {
      // Go back to index.html (reload the page to root)
      window.location.href = window.location.origin + window.location.pathname;
    });
  }
}

function bindRoomButtons() {
  document.querySelectorAll('.room-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentRoom = parseInt(btn.dataset.room);
      currentPage = 1;
      fetchAssetData(currentRoom);
    });
  });
}

function bindFilterCheckboxes() {
  document.getElementById('filter-image').addEventListener('change', renderGallery);
  document.getElementById('filter-video').addEventListener('change', renderGallery);
}

async function fetchAssetData(room) {
  try {
    const response = await fetch(`${BACKEND_URL}/list/${room}`);
    if (!response.ok) throw new Error('Failed to fetch');
    const data = await response.json();
    // If the backend returns an array directly, use it. If it returns an object, try to extract the array.
    if (Array.isArray(data)) {
      assetData = data;
    } else if (Array.isArray(data.data)) {
      assetData = data.data;
    } else if (data.assets && Array.isArray(data.assets)) {
      assetData = data.assets;
    } else {
      assetData = [];
      console.warn('Unexpected asset data format:', data);
    }
    renderGallery();
  } catch (error) {
    console.error("Error fetching assets:", error);
    assetData = [];
    renderGallery();
  }
}

function renderGallery() {
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // Show all assets as images (skip extension filtering)
  const filteredAssets = assetData;

  const start = (currentPage - 1) * itemsPerPage;
  const paginated = filteredAssets.slice(start, start + itemsPerPage);

  paginated.forEach(asset => {
    const item = document.createElement('div');
    item.className = 'asset-item border p-2 rounded shadow flex flex-col items-center';
    item.innerHTML = `
      <img src="https://gateway.pinata.cloud/ipfs/${asset.asset_cid}" alt="${asset.title}" class="w-full h-40 object-cover rounded" />
      <div class="text-sm mt-2 font-semibold text-center">${asset.title}</div>
    `;
    item.addEventListener('click', () => showAssetDetail(asset));
    grid.appendChild(item);
  });

  renderPagination(filteredAssets.length);
}

function renderPagination(totalItems) {
  const grid = document.getElementById('gallery-grid');
  const totalPages = Math.ceil(totalItems / itemsPerPage);

  if (totalPages <= 1) return;

  const nav = document.createElement('div');
  nav.className = 'pagination mt-4 col-span-4 flex justify-center';

  for (let i = 1; i <= totalPages; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    btn.className = `mx-1 px-3 py-1 rounded ${i === currentPage ? 'bg-blue-500 text-white' : 'bg-gray-200'}`;
    btn.addEventListener('click', () => {
      currentPage = i;
      renderGallery();
    });
    nav.appendChild(btn);
  }

  grid.appendChild(nav);
}

function showAssetDetail(asset) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-white p-6 rounded w-1/2 max-w-lg">
      <h2 class="text-xl font-bold mb-2">${asset.title}</h2>
      <img src="https://gateway.pinata.cloud/ipfs/${asset.asset_cid}" class="w-full h-64 object-contain rounded mb-3" />
      <p class="text-sm">${asset.viet_des || asset.en_des || 'No description available'}</p>
      <div class="text-right mt-4">
        <button class="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400" id="close-modal">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#close-modal').addEventListener('click', () => {
    modal.remove();
  });
}