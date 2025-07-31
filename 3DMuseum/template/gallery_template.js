export default `
<div id="gallery_page" class="GalleryPageContainer w-full min-h-full flex flex-row">
  <!-- Left Column: Filter Panel -->
  <div class="LeftSidebar w-1/4 min-h-screen bg-gray-100 p-5">
    <div class="filter-section text-lg font-semibold mb-4">Select Type</div>
    <div class="filter-options text-sm">
      <div class="mb-2">
        <input type="checkbox" id="filter-image" checked>
        <label for="filter-image">Images</label>
      </div>
      <div class="mb-4">
        <input type="checkbox" id="filter-video">
        <label for="filter-video">Videos</label>
      </div>
    </div>
  </div>

  <!-- Right Column: Content -->
  <div class="RightContent w-3/4 min-h-screen flex flex-col p-5 overflow-y-auto">
    <!-- Top Room Selection -->
    <div class="RoomSelection flex flex-row justify-between mb-3">
      <button class="room-btn bg-blue-200 rounded px-4 py-2" data-room="1">Room 1</button>
      <button class="room-btn bg-blue-200 rounded px-4 py-2" data-room="2">Room 2</button>
      <button class="room-btn bg-blue-200 rounded px-4 py-2" data-room="3">Room 3</button>
    </div>

    <hr class="my-3" />

    <!-- Gallery Grid -->
    <div id="gallery-grid" class="GalleryGrid grid grid-cols-4 gap-4">
      <!-- Each item will be injected dynamically here -->
    </div>
  </div>
</div>
`