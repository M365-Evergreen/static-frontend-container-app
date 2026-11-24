import { DocumentGrid } from '../components/DocumentGrid/DocumentGrid';
import { SearchBox } from '../components/SearchBox/SearchBox';

export function DocumentsPage() {
    return (
        <>
            <SearchBox />
            <DocumentGrid documents={[]} />
        </>
    );
}

export default DocumentsPage;