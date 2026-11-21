// ホワイトリスト60種の lucide-react アイコン描画コンポーネント（strokeWidth={1.75}, currentColor 統一）

import React from 'react';
import {
  Activity,
  AlertCircle,
  Award,
  Bell,
  BookOpen,
  Briefcase,
  Building,
  Calendar,
  Camera,
  Car,
  CheckCircle,
  Clock,
  CloudRain,
  Coffee,
  Compass,
  CreditCard,
  FileText,
  Flag,
  Flame,
  Gift,
  Headphones,
  Heart,
  HelpCircle,
  Home,
  Key,
  Laptop,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  Moon,
  Music,
  Navigation,
  Package,
  PenTool,
  Phone,
  Plane,
  Search,
  Settings,
  Shield,
  ShoppingBag,
  Smartphone,
  Star,
  Sun,
  Target,
  Thermometer,
  ThumbsUp,
  Train,
  Trophy,
  Truck,
  Tv,
  Umbrella,
  Unlock,
  User,
  Users,
  Utensils,
  Wind,
  Wrench,
  XCircle,
  Zap,
  type LucideProps,
} from 'lucide-react';
import { DEFAULT_ICON, type IconName } from '../types';

export const WHITELIST_ICON_COMPONENTS: Record<
  IconName,
  React.ComponentType<LucideProps>
> = {
  Coffee,
  Briefcase,
  Trophy,
  Flame,
  Clock,
  MapPin,
  User,
  Users,
  MessageSquare,
  Phone,
  Mail,
  Calendar,
  ShoppingBag,
  CreditCard,
  Utensils,
  Train,
  Plane,
  Car,
  Home,
  Building,
  Laptop,
  Smartphone,
  Headphones,
  Music,
  Tv,
  Camera,
  BookOpen,
  FileText,
  PenTool,
  Search,
  Bell,
  Heart,
  Star,
  ThumbsUp,
  AlertCircle,
  HelpCircle,
  CheckCircle,
  XCircle,
  Zap,
  Sun,
  Moon,
  CloudRain,
  Wind,
  Umbrella,
  Thermometer,
  Activity,
  Award,
  Target,
  Flag,
  Compass,
  Navigation,
  Key,
  Lock,
  Unlock,
  Shield,
  Gift,
  Package,
  Truck,
  Wrench,
  Settings,
};

export interface WhitelistedIconProps {
  name: string;
  size?: number;
  className?: string;
}

/**
 * ホワイトリスト内のアイコンを描画し、万一リスト外が指定された場合は既定のアイコン（MessageSquare）に置き換える（要件7）
 */
export const WhitelistedIcon: React.FC<WhitelistedIconProps> = ({
  name,
  size = 24,
  className,
}) => {
  const IconComp =
    (WHITELIST_ICON_COMPONENTS as Record<string, React.ComponentType<LucideProps>>)[
      name
    ] ?? WHITELIST_ICON_COMPONENTS[DEFAULT_ICON];

  return (
    <IconComp
      size={size}
      strokeWidth={1.75}
      color="currentColor"
      className={className}
    />
  );
};
