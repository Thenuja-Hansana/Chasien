import { Navigate, Route, Routes } from 'react-router-dom';
import PhoneFrame from './components/PhoneFrame';
import Login from './screens/Login';
import SignUp from './screens/SignUp';
import Discover from './screens/Discover';
import Home from './screens/Home';
import PostDetail from './screens/PostDetail';
import StoryViewer from './screens/StoryViewer';
import CreatePost from './screens/CreatePost';
import Chats from './screens/Chats';
import ChatView from './screens/ChatView';
import CommunitySettings from './screens/CommunitySettings';
import Profile from './screens/Profile';
import CreateCommunity from './screens/CreateCommunity';
import Notifications from './screens/Notifications';
import Search from './screens/Search';

export default function App() {
  return (
    <PhoneFrame>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/c/:communityId" element={<Home />} />
        <Route path="/c/:communityId/post/:postId" element={<PostDetail />} />
        <Route path="/c/:communityId/story" element={<StoryViewer />} />
        <Route path="/c/:communityId/create-post" element={<CreatePost />} />
        <Route path="/c/:communityId/settings" element={<CommunitySettings />} />
        <Route path="/chats" element={<Chats />} />
        <Route path="/chats/:chatId" element={<ChatView />} />
        <Route path="/u/:userId" element={<Profile />} />
        <Route path="/create-community" element={<CreateCommunity />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/search" element={<Search />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </PhoneFrame>
  );
}
