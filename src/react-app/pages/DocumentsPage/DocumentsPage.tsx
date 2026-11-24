
import { Button } from '../../components/Button/Button';
import { SearchBox } from '../../components/SearchBox/SearchBox';
import { Plus } from 'lucide-react'
import styles from './DocumentsPage.module.css';
import { FileGrid } from '../../components/FileGrid/FileGrid';


export function DocumentsPage() {
    return (
        <> <main className={styles.documentsPage}>
            <div className={styles.commandBar}>
                <div className={styles.searchBox}><SearchBox /></div>
                <div className={styles.commands }>
                    <Button className={styles.commandButton}><Plus /> New Document</Button>
                </div>            
            </div>

            <div className={styles.documentGrid}>
                <FileGrid />
            </div>
        </main>
        </>
    );
}

export default DocumentsPage;