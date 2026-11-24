import {NavigationTree, NavigationTreeItem, NavigationTreeItemContent, NavigationTreeItemLink} from './NavigationTree';
import {Button} from '../Button/Button';
import {MoreHorizontal} from 'lucide-react';
import {Router, Link as RouterLink} from './Router';
import styles from './NavigationTree.module.css'

export const Sidebar = () => { 
  return (

<Router defaultSelectedRoute="/photos">
  {({selectedRoute}) => (
    <NavigationTree aria-label="Files" selectedRoute={selectedRoute} renderLink={props => <RouterLink {...props} />} defaultExpandedKeys={['files']}>
      <NavigationTreeItem id="home" href="/home" textValue="Home">
        <NavigationTreeItemContent>
          <NavigationTreeItemLink>Home</NavigationTreeItemLink>
          <Button className={styles.moreButton} aria-label="More options"><MoreHorizontal size={16} aria-hidden /></Button>
        </NavigationTreeItemContent>
      </NavigationTreeItem>
      <NavigationTreeItem id="files" href="/files" textValue="Files">
        <NavigationTreeItemContent>
          <NavigationTreeItemLink>Files</NavigationTreeItemLink>
          <Button className={styles.moreButton} aria-label="More options"><MoreHorizontal size={16} aria-hidden /></Button>
        </NavigationTreeItemContent>
        <NavigationTreeItem id="photos" href="/photos" textValue="Photos">
          <NavigationTreeItemContent>
            <NavigationTreeItemLink>Photos</NavigationTreeItemLink>
            <Button className={styles.moreButton} aria-label="More options"><MoreHorizontal size={16} aria-hidden /></Button>
          </NavigationTreeItemContent>
        </NavigationTreeItem>
        <NavigationTreeItem id="videos" href="/videos" textValue="Videos">
          <NavigationTreeItemContent>
            <NavigationTreeItemLink>Videos</NavigationTreeItemLink>
            <Button className={styles.moreButton} aria-label="More options"><MoreHorizontal size={16} aria-hidden /></Button>
          </NavigationTreeItemContent>
        </NavigationTreeItem>
      </NavigationTreeItem>
      <NavigationTreeItem id="shared" textValue="Shared">
        <NavigationTreeItemContent>
          <NavigationTreeItemLink>Shared</NavigationTreeItemLink>
          <Button className={styles.moreButton} aria-label="More options"><MoreHorizontal size={16} aria-hidden /></Button>
        </NavigationTreeItemContent>
        <NavigationTreeItem id="food" href="/food" textValue="Food">
          <NavigationTreeItemContent>
            <NavigationTreeItemLink>Food</NavigationTreeItemLink>
            <Button className={styles.moreButton} aria-label="More options"><MoreHorizontal size={16} aria-hidden /></Button>
          </NavigationTreeItemContent>
        </NavigationTreeItem>
        <NavigationTreeItem id="drinks" href="/drinks" textValue="Drinks">
          <NavigationTreeItemContent>
            <NavigationTreeItemLink>Drinks</NavigationTreeItemLink>
            <Button className={styles.moreButton} aria-label="More options"><MoreHorizontal size={16} aria-hidden /></Button>
          </NavigationTreeItemContent>
        </NavigationTreeItem>
      </NavigationTreeItem>
    </NavigationTree>
  )}
</Router>
  );
};
export default Sidebar;
