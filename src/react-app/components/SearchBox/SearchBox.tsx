import {SearchField} from './SearchField';

export function SearchBox(props: any) {
  return (
    <SearchField
      label="Search"
      placeholder="Search documents"
      {...props}
    />
  );
}

  export default SearchBox;