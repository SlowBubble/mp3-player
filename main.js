// Global variables
let currentTracks = [];
let currentTrackIndex = 0;
let audioPlayer = null;
let isPlaying = false;
let wakeLock = null;

// DOM elements
const fileInput = document.getElementById('file-input');
const playlist = document.getElementById('playlist');
const emptyState = document.getElementById('empty-state');
const homePage = document.getElementById('home-page');
const playerPage = document.getElementById('player-page');
const playerControls = document.getElementById('player-controls');
const currentTrackTitle = document.getElementById('current-track-title');
const playPauseBtn = document.getElementById('play-pause-btn');
const progressFill = document.getElementById('progress-fill');
const currentTimeSpan = document.getElementById('current-time');
const totalTimeSpan = document.getElementById('total-time');
const progressBar = document.getElementById('progress-bar');

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    audioPlayer = document.getElementById('audio-player');
    setupEventListeners();
    registerServiceWorker();
});

// Register service worker for better background support
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            // Create a minimal service worker inline
            const swCode = `
                self.addEventListener('message', event => {
                    if (event.data && event.data.type === 'KEEP_ALIVE') {
                        // Keep service worker alive
                        event.ports[0].postMessage('OK');
                    }
                });
            `;
            
            const blob = new Blob([swCode], { type: 'application/javascript' });
            const swUrl = URL.createObjectURL(blob);
            
            await navigator.serviceWorker.register(swUrl);
            console.log('Service worker registered for background support');
        } catch (error) {
            console.log('Service worker registration failed:', error);
        }
    }
}

// Setup event listeners
function setupEventListeners() {
    // File input change
    fileInput.addEventListener('change', handleFileSelection);
    
    // Audio player events
    audioPlayer.addEventListener('loadedmetadata', updateDuration);
    audioPlayer.addEventListener('timeupdate', updateProgress);
    audioPlayer.addEventListener('ended', handleTrackEnd);
    audioPlayer.addEventListener('canplay', function() {
        // Auto-play when track is ready (mobile browsers may block this)
        if (isPlaying) {
            audioPlayer.play().catch(e => console.log('Auto-play blocked:', e));
        }
    });
    
    // Progress bar click
    progressBar.addEventListener('click', seekToPosition);
}

// Handle file selection
function handleFileSelection(event) {
    const files = Array.from(event.target.files);
    const mp3Files = files.filter(file => file.type === 'audio/mpeg' || file.name.toLowerCase().endsWith('.mp3'));
    
    if (mp3Files.length === 0) {
        alert('No MP3 files found in the selected folder.');
        return;
    }
    
    currentTracks = mp3Files.map((file, index) => ({
        id: index,
        name: file.name.replace('.mp3', ''),
        file: file,
        url: URL.createObjectURL(file)
    }));
    
    displayPlaylist();
    emptyState.style.display = 'none';
}

// Display playlist
function displayPlaylist() {
    playlist.innerHTML = '';
    
    currentTracks.forEach((track, index) => {
        const trackElement = document.createElement('div');
        trackElement.className = 'track-item';
        trackElement.onclick = () => playTrack(index);
        
        trackElement.innerHTML = `
            <div class="track-name">${track.name}</div>
            <div class="track-duration">Click to play</div>
        `;
        
        playlist.appendChild(trackElement);
    });
}

// Play a specific track
function playTrack(index) {
    if (index < 0 || index >= currentTracks.length) return;
    
    currentTrackIndex = index;
    const track = currentTracks[index];
    
    // Update UI
    currentTrackTitle.textContent = track.name;
    
    // Load and play audio
    audioPlayer.src = track.url;
    audioPlayer.load();
    
    // Show player page
    showPlayerPage();
    
    // Start playing
    isPlaying = true;
    updatePlayPauseButton();
    
    // Setup Media Session API for background playback
    setupMediaSession(track);
    
    // Try to play (may be blocked on mobile until user interaction)
    audioPlayer.play().catch(e => {
        console.log('Play blocked, waiting for user interaction:', e);
        isPlaying = false;
        updatePlayPauseButton();
    });
}

// Toggle play/pause
function togglePlayPause() {
    if (!audioPlayer.src) return;
    
    if (isPlaying) {
        audioPlayer.pause();
        isPlaying = false;
    } else {
        audioPlayer.play().then(() => {
            isPlaying = true;
        }).catch(e => {
            console.log('Play failed:', e);
            isPlaying = false;
        });
    }
    
    updatePlayPauseButton();
    updateMediaSessionState();
}

// Update play/pause button
function updatePlayPauseButton() {
    playPauseBtn.textContent = isPlaying ? '⏸️' : '▶️';
    playPauseBtn.title = isPlaying ? 'Pause' : 'Play';
}

// Rewind 15 seconds
function rewind15() {
    if (audioPlayer.src) {
        audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 15);
    }
}

// Forward 15 seconds
function forward15() {
    if (audioPlayer.src) {
        audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 15);
    }
}

// Update duration display
function updateDuration() {
    if (audioPlayer.duration) {
        totalTimeSpan.textContent = formatTime(audioPlayer.duration);
    }
}

// Update progress
function updateProgress() {
    if (audioPlayer.duration) {
        const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        progressFill.style.width = progress + '%';
        currentTimeSpan.textContent = formatTime(audioPlayer.currentTime);
        
        // Update Media Session position periodically
        updateMediaSessionState();
    }
}

// Handle track end
function handleTrackEnd() {
    isPlaying = false;
    updatePlayPauseButton();
    
    // Auto-play next track if available
    if (currentTrackIndex < currentTracks.length - 1) {
        playTrack(currentTrackIndex + 1);
    }
}

// Seek to position
function seekToPosition(event) {
    if (!audioPlayer.duration) return;
    
    const rect = progressBar.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * audioPlayer.duration;
    
    audioPlayer.currentTime = newTime;
}

// Format time (seconds to mm:ss)
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Show home page
function showHomePage() {
    homePage.classList.add('active');
    playerPage.classList.remove('active');
    playerControls.style.display = 'none';
    
    // Pause audio when going back
    if (isPlaying) {
        audioPlayer.pause();
        isPlaying = false;
        updatePlayPauseButton();
    }
}

// Show player page
function showPlayerPage() {
    homePage.classList.remove('active');
    playerPage.classList.add('active');
    playerControls.style.display = 'block';
}

// Setup Media Session API for background playback
function setupMediaSession(track) {
    if ('mediaSession' in navigator) {
        // Set metadata
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.name,
            artist: 'Unknown Artist',
            album: 'Local Files',
            artwork: [
                { src: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDUxMiA1MTIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiBmaWxsPSIjMzMzIi8+Cjx0ZXh0IHg9IjI1NiIgeT0iMjU2IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iNDAiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+4pmqPC90ZXh0Pgo8L3N2Zz4K', sizes: '512x512', type: 'image/svg+xml' }
            ]
        });

        // Set action handlers
        navigator.mediaSession.setActionHandler('play', () => {
            audioPlayer.play();
            isPlaying = true;
            updatePlayPauseButton();
        });

        navigator.mediaSession.setActionHandler('pause', () => {
            audioPlayer.pause();
            isPlaying = false;
            updatePlayPauseButton();
        });

        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
            const skipTime = details.seekOffset || 15;
            audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - skipTime);
        });

        navigator.mediaSession.setActionHandler('seekforward', (details) => {
            const skipTime = details.seekOffset || 15;
            audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + skipTime);
        });

        navigator.mediaSession.setActionHandler('previoustrack', () => {
            if (currentTrackIndex > 0) {
                playTrack(currentTrackIndex - 1);
            }
        });

        navigator.mediaSession.setActionHandler('nexttrack', () => {
            if (currentTrackIndex < currentTracks.length - 1) {
                playTrack(currentTrackIndex + 1);
            }
        });

        // Update playback state
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
}

// Update Media Session playback state
function updateMediaSessionState() {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
        
        // Update position state for better scrubbing support
        if (audioPlayer.duration) {
            navigator.mediaSession.setPositionState({
                duration: audioPlayer.duration,
                playbackRate: audioPlayer.playbackRate,
                position: audioPlayer.currentTime
            });
        }
    }
    
    // Manage wake lock
    if (isPlaying) {
        requestWakeLock();
    } else {
        releaseWakeLock();
    }
}

// Request wake lock to prevent screen from turning off
async function requestWakeLock() {
    if ('wakeLock' in navigator && !wakeLock) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake lock acquired');
            
            wakeLock.addEventListener('release', () => {
                console.log('Wake lock released');
                wakeLock = null;
            });
        } catch (err) {
            console.log('Wake lock failed:', err);
        }
    }
}

// Release wake lock
function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release();
        wakeLock = null;
    }
}

// Handle mobile-specific behaviors
document.addEventListener('visibilitychange', function() {
    // Don't pause when tab becomes hidden - let Media Session API handle it
    // This allows background playback on mobile
    console.log('Visibility changed:', document.hidden ? 'hidden' : 'visible');
});

// Prevent zoom on double tap for better mobile experience
let lastTouchEnd = 0;
document.addEventListener('touchend', function(event) {
    const now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
        event.preventDefault();
    }
    lastTouchEnd = now;
}, false);