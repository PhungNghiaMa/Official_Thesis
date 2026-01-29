// This code provides services for interacting with the backend of the 3D museum application.
// It includes functions to fetch room assets, upload new items, generate AI responses, 
// and manage WebSocket connections for real-time updates.

const BACKEND_URL =
  import.meta.env.MODE === "production"
    ? import.meta.env.VITE_PROD_BACKEND_URL // Use VITE_ prefix
    : import.meta.env.VITE_BACKEND_URL;     // Use VITE_ prefix

const BACKEND_BASE = 
    import.meta.env.MODE === "production"
    ? import.meta.env.VITE_PROD_BACKEND_BASE // Use VITE_ prefix
    : import.meta.env.VITE_BACKEND_BASE;     // Use VITE_ prefix


// API FETCH ALL INFORMATION FOR SPECIFIC ROOM
export async function GetRoomAsset(roomID) {
    const url = `${BACKEND_URL}/list/${roomID}`
    const response =  await fetch(url, {
        method: 'GET'
    })
    return await response.json()
}

// This function is used to validate the data input before uploading to the backend
const validateData = (data) => {

	if (!data.title || data.title.length > 100) {
		return 'Title is required and must be at most 100 characters.'
	}
	if (!data.vietnamese_description) {
		return 'Vietnamese description is required'
	}
	if (!data.english_description.length) {
		return 'English description is required'
	}
	return ''
}

// API UPLOAD ITEM TO BACKEND
export const UploadItem = async (file, mesh_name , title, vietnamese_description, english_description, roomID) => {
    const formData = new FormData()

    const error = validateData({ title, vietnamese_description, english_description })

    if (error !== '') {
        console.log("error: ", error)
        throw new Error(error)
    }

    // Append the file to the form data. The browser will automatically include the filename.
    // The backend should extract the filename from this 'file' part of the request.
    formData.append('file', file)
    formData.append('mesh_name', mesh_name)
    formData.append('title', title)
    formData.append('vietnamese_description', vietnamese_description)
    formData.append('english_description', english_description)
    formData.append('roomID', roomID)

    try {
        const response = await fetch(`${BACKEND_URL}/upload`, {
            method: 'POST',
            body: formData
        })

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error: ${response.status} ${response.statusText} - ${errorText}`)
        }

        const result = await response.json()
        return result
    } catch (error) {
        console.error('Error uploading item:', error)
        throw error
    }
}

/**
 * Sends the player request to the Go backend.
 * @param {string} webpCID - The IPFS CID for the image (from Pinata).
 * @param {string} prompt - The user's question about the painting.
 * @param {string} playerID - The unique ID of the player.
 */
// API GENERATE ANSWER FROM BACKEND USING AI MODEL
export const GenAI = async (webpCID, prompt, playerID) => {
    try {
        const formData = new FormData();
        
        // These keys MUST match the strings inside Go c.PostForm("...") calls
        // formData.append("player_id", playerID);
        formData.append("prompt", prompt);
        formData.append("webp_cid", webpCID);

        const response = await fetch(`${BACKEND_URL}/generate_answer`, {
            method: "POST",
            body: formData, 
            // Note: No 'Content-Type' header needed, 
            // browser sets it to multipart/form-data automatically
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "Failed to get answer from server");
        }

        return result.answer;

    } catch (error) {
        console.error("GenAI Error:", error);
        return "Sorry, I couldn't analyze that image right now.";
    }
};

// WEBSOCKET instance and management
let _ws = null 
const _subscribed = new Set()
let _reconnectTimer = null 

// This function return the websocket URL based on the current protocol (ws or wss)
function wsURL(){
    let protocol = window.location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${BACKEND_BASE}/ws`;
}

// Start or return existing WebSocket connection
export function StartWebSocket() {
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return _ws;
  _ws = new WebSocket(wsURL());

  _ws.onopen = () => {
    console.info("[WS] CONNECTED");
    for (const channel of Array.from(_subscribed)) {
      try {
        _ws.send(JSON.stringify({ action: "subscribe", channel }));
      } catch (e) {
        console.error("ERROR IN SUBSCRIBE:", e);
      }
    }
  };

  _ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    // console.log("RAW WEBSOCKET MESSAGE:", data);

    // Normalize message type
    const inferredType = data.type || inferTypeFromStage(data.stage);

    // DEBUG TRACE
    console.groupCollapsed(`[WS] 🔹 Incoming message (${inferredType})`);
    // console.log("Stage:", data.stage);
    // console.log("Status:", data.status);
    // console.log("Progress:", data.progress);
    // console.log("Channel:", data.channel);
    console.groupEnd();

    // Normalize: forward all to same event
    window.dispatchEvent(
      new CustomEvent("ws:upload-progress", { detail: { ...data, type: inferredType } })
    );
  };


  // ✅ Debug: log all incoming WebSocket messages
  _ws.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data);
      console.groupCollapsed(`[WS] 🔹 Incoming message (${data?.type || "unknown"})`);
      // console.log("Full payload:", data);
      console.groupEnd();
    } catch (err) {
      console.warn("[WS] Non-JSON message:", event.data);
    }
  });

  // ✅ Debug: log all sent messages (subscribe, unsubscribe, etc.)
  const _oldSend = _ws.send.bind(_ws);
  _ws.send = (data) => {
    console.groupCollapsed("[WS] ⬆️ Outgoing message");
    console.log(data);
    console.groupEnd();
    return _oldSend(data);
  };


  _ws.onclose = () => {
    console.log("[WS] DISCONNECTED");
    _ws = null;
    if (_reconnectTimer == null) {
      _reconnectTimer = setTimeout(() => {
        _reconnectTimer = null;
        StartWebSocket();
      }, 2000);
    }
  };

  _ws.onerror = (e) => console.error("[WS] ERROR:", e);
  return _ws;
}

// Infer message type from stage string
function inferTypeFromStage(stage) {
  if (!stage) return "unknown";
  if (/tts/i.test(stage)) return "tts";
  if (/upload|convert|webp|database|pipeline/i.test(stage)) return "upload";
  return "unknown";
}

// Subscribe to a specific channel for updates
export function SubscribeChannel(channel) {
  if (!channel) return;
  if (_subscribed.has(channel)) return;
  _subscribed.add(channel);

  const sendSubscribe = () => {
    try {
      _ws.send(JSON.stringify({ action: "subscribe", channel }));
      console.info("[WS] Subscribed:", channel);
    } catch (e) {
      console.error("[WS] FAIL TO SUBSCRIBE:", e);
    }
  };

  if (!_ws || _ws.readyState !== WebSocket.OPEN) {
    // Wait for socket to open
    const interval = setInterval(() => {
      if (_ws && _ws.readyState === WebSocket.OPEN) {
        clearInterval(interval);
        sendSubscribe();
      }
    }, 200);
  } else {
    sendSubscribe();
  }
}

// Unsubscribe from a specific channel
export function unsubscribeChannel(channel) {
  if (!_ws) return;
  _subscribed.delete(channel);
  try {
    _ws.send(JSON.stringify({ action: "unsubscribe", channel }));
  } catch (e) {}
}

// Close the WebSocket connection
export function closeWebSocket() {
  if (_ws) _ws.close();
  _ws = null;
  _subscribed.clear();
}



